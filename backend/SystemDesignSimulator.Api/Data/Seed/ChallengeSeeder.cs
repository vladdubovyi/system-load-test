using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using SystemDesignSimulator.Api.Models;

namespace SystemDesignSimulator.Api.Data.Seed;

public static class ChallengeSeeder
{
    public static void SeedData(ApplicationDbContext context)
    {
        if (context.Challenges.Any())
        {
            return;
        }
        
        SeedComponentDefinitions(context);
        SeedChallenges(context);
        
        context.SaveChanges();
    }

    public static void EnsureChallengeContent(ApplicationDbContext context)
    {
        var contentBySlug = GetChallengeContent();
        var challenges = context.Challenges.ToList();
        var updated = false;

        foreach (var challenge in challenges)
        {
            if (!contentBySlug.TryGetValue(challenge.Slug, out var content))
            {
                continue;
            }

            if (string.IsNullOrWhiteSpace(challenge.OverviewContent))
            {
                challenge.OverviewContent = content.Overview;
                updated = true;
            }

            if (string.IsNullOrWhiteSpace(challenge.VideoUrl))
            {
                challenge.VideoUrl = content.VideoUrl;
                updated = true;
            }
        }

        if (updated)
        {
            context.SaveChanges();
        }
    }

    /// <summary>
    /// Backfill flows/objectives into scenarios and capabilities into component
    /// definitions that predate flow correctness. Idempotent: only keys that
    /// are missing are added, so authored edits are never overwritten.
    /// </summary>
    public static void EnsureFlowDefinitions(ApplicationDbContext context)
    {
        var updated = false;

        foreach (var scenario in context.Scenarios.Include(s => s.Challenge).ToList())
        {
            var slug = scenario.Challenge?.Slug;
            if (slug == null) continue;
            var flows = FlowDefinitions.Flows(slug);
            if (flows.Length == 0) continue;

            var config = ParseObject(scenario.ScenarioConfig);
            var changed = false;
            if (!config.ContainsKey("flows"))
            {
                config["flows"] = JsonSerializer.SerializeToElement(flows);
                changed = true;
            }
            var objectives = FlowDefinitions.ObjectivesFor(slug);
            if (objectives != null && !config.ContainsKey("objectives"))
            {
                config["objectives"] = JsonSerializer.SerializeToElement(objectives);
                changed = true;
            }
            if (changed)
            {
                scenario.ScenarioConfig = JsonSerializer.Serialize(config);
                updated = true;
            }
        }

        foreach (var definition in context.ComponentDefinitions.ToList())
        {
            if (FlowDefinitions.CapabilitiesFromSchema(definition.ConfigSchema) != null) continue;
            var capabilities = FlowDefinitions.Capabilities(definition.ComponentType);
            if (capabilities.Length == 0) continue;

            var schema = ParseObject(definition.ConfigSchema);
            schema["capabilities"] = JsonSerializer.SerializeToElement(capabilities);
            definition.ConfigSchema = JsonSerializer.Serialize(schema);
            updated = true;
        }

        if (updated)
        {
            context.SaveChanges();
        }
    }

    private static Dictionary<string, JsonElement> ParseObject(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new Dictionary<string, JsonElement>();
        try
        {
            return JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(json)
                ?? new Dictionary<string, JsonElement>();
        }
        catch (JsonException)
        {
            return new Dictionary<string, JsonElement>();
        }
    }

    private static Dictionary<string, (string Overview, string VideoUrl)> GetChallengeContent() => new()
    {
        ["url-shortener"] = (
            Overview: """
                URL shorteners are a classic system design interview question because they combine read-heavy traffic, viral spikes, and a deceptively simple API.

                **What interviewers look for**
                - How you handle billions of redirects per day with low latency
                - Encoding strategies for short codes (hashing vs. counters)
                - Caching hot links and surviving celebrity traffic spikes
                - Database schema for mappings and analytics

                **Key concepts to practice**
                - Read/write ratio and cache placement
                - Horizontal scaling behind a load balancer
                - Rate limiting for create endpoints
                - CDN vs. application-layer caching for redirects

                Use the sandbox to wire components, run traffic, and see where your architecture breaks under load.
                """,
            VideoUrl: "https://www.youtube.com/watch?v=J9u85GqdRM8"
        ),
        ["dropbox"] = (
            Overview: """
                File storage systems test your understanding of durability, large payloads, and metadata separation.

                **What interviewers look for**
                - Upload/download paths for large files
                - Metadata vs. blob storage split
                - Sync and conflict resolution at a high level
                - Durability guarantees and replication

                **Key concepts to practice**
                - Object storage for blobs, relational/NoSQL for metadata
                - Chunking, resumable uploads, and background workers
                - Bandwidth and storage cost tradeoffs
                - Queue-based processing for virus scan / thumbnails

                Try building a pipeline that keeps metadata lookups fast while uploads fan out to durable storage.
                """,
            VideoUrl: "https://www.youtube.com/watch?v=U0xTu6E2CT8"
        ),
        ["instagram-feed"] = (
            Overview: """
                Feed systems are read-heavy, latency-sensitive, and fan out across many services — a staple senior-level interview topic.

                **What interviewers look for**
                - Feed generation: pull vs. push vs. hybrid models
                - Caching strategies for celebrity accounts
                - Media delivery and CDN usage
                - Ranking, pagination, and hot-key mitigation

                **Key concepts to practice**
                - Fan-out on write vs. fan-out on read
                - Sharded timelines and precomputed feeds
                - Object storage + CDN for photos/video
                - Async pipelines (Kafka/workers) for notifications

                Simulate spike traffic and see whether your feed path stays under 200ms.
                """,
            VideoUrl: "https://www.youtube.com/watch?v=KmAyPUv1YTI"
        ),
        ["rate-limiter"] = (
            Overview: """
                Rate limiters protect APIs from abuse and are often discussed as a standalone service or middleware component.

                **What interviewers look for**
                - Token bucket vs. sliding window vs. fixed window
                - Distributed counters with Redis
                - Per-user, per-IP, and per-API-key limits
                - Fail-open vs. fail-closed behavior

                **Key concepts to practice**
                - Centralized vs. edge rate limiting
                - Redis atomic operations and TTL keys
                - Consistent hashing for sharded limiters
                - Returning 429 responses with Retry-After headers

                A great warm-up challenge before tackling larger designs.
                """,
            VideoUrl: "https://www.youtube.com/watch?v=FU4WlWF_SIQ"
        ),
    };
    
    private static void SeedComponentDefinitions(ApplicationDbContext context)
    {
        var components = new List<ComponentDefinition>
        {
            // Networking
            new() {
                Id = Guid.NewGuid(),
                ComponentType = "load-balancer",
                ConfigSchema = FlowDefinitions.CapabilitiesSchema("load-balancer"),
                Label = "Load Balancer",
                Category = "networking",
                DefaultCapacity = 800,
                DefaultQueueLimit = 120,
                MonthlyCost = 120,
                Emoji = "⚖️",
                Description = "Distributes incoming traffic across multiple servers",
                Width = 140,
                Height = 72,
                Enabled = true
            },
            new() {
                Id = Guid.NewGuid(),
                ComponentType = "api-gateway",
                ConfigSchema = FlowDefinitions.CapabilitiesSchema("api-gateway"),
                Label = "API Gateway",
                Category = "networking",
                DefaultCapacity = 1000,
                DefaultQueueLimit = 150,
                MonthlyCost = 150,
                Emoji = "🚪",
                Description = "Central entry point for API requests with routing, authentication, and rate limiting",
                Width = 140,
                Height = 72,
                Enabled = true
            },
            new() {
                Id = Guid.NewGuid(),
                ComponentType = "cdn",
                ConfigSchema = FlowDefinitions.CapabilitiesSchema("cdn"),
                Label = "CDN",
                Category = "networking",
                DefaultCapacity = 5000,
                DefaultQueueLimit = 200,
                MonthlyCost = 200,
                Emoji = "🌐",
                Description = "Content Delivery Network for caching static assets globally",
                Width = 120,
                Height = 72,
                Enabled = true
            },
            new() {
                Id = Guid.NewGuid(),
                ComponentType = "dns",
                ConfigSchema = FlowDefinitions.CapabilitiesSchema("dns"),
                Label = "DNS",
                Category = "networking",
                DefaultCapacity = 10000,
                DefaultQueueLimit = 100,
                MonthlyCost = 50,
                Emoji = "🔍",
                Description = "Domain Name System for hostname resolution",
                Width = 120,
                Height = 72,
                Enabled = true
            },
            new() {
                Id = Guid.NewGuid(),
                ComponentType = "reverse-proxy",
                ConfigSchema = FlowDefinitions.CapabilitiesSchema("reverse-proxy"),
                Label = "Reverse Proxy",
                Category = "networking",
                DefaultCapacity = 1200,
                DefaultQueueLimit = 150,
                MonthlyCost = 80,
                Emoji = "🔄",
                Description = "Forwards client requests to backend servers",
                Width = 140,
                Height = 72,
                Enabled = true
            },
            
            // Compute
            new() {
                Id = Guid.NewGuid(),
                ComponentType = "backend-service",
                ConfigSchema = FlowDefinitions.CapabilitiesSchema("backend-service"),
                Label = "Backend Service",
                Category = "compute",
                DefaultCapacity = 220,
                DefaultQueueLimit = 90,
                MonthlyCost = 200,
                Emoji = "🔧",
                Description = "Application server handling business logic",
                Width = 150,
                Height = 72,
                Enabled = true
            },
            new() {
                Id = Guid.NewGuid(),
                ComponentType = "microservice",
                ConfigSchema = FlowDefinitions.CapabilitiesSchema("microservice"),
                Label = "Microservice",
                Category = "compute",
                DefaultCapacity = 180,
                DefaultQueueLimit = 80,
                MonthlyCost = 180,
                Emoji = "⚙️",
                Description = "Independent service handling specific business capability",
                Width = 150,
                Height = 72,
                Enabled = true
            },
            new() {
                Id = Guid.NewGuid(),
                ComponentType = "worker-service",
                ConfigSchema = FlowDefinitions.CapabilitiesSchema("worker-service"),
                Label = "Worker Service",
                Category = "compute",
                DefaultCapacity = 150,
                DefaultQueueLimit = 200,
                MonthlyCost = 160,
                Emoji = "👷",
                Description = "Background worker for async job processing",
                Width = 150,
                Height = 72,
                Enabled = true
            },
            new() {
                Id = Guid.NewGuid(),
                ComponentType = "serverless-function",
                ConfigSchema = FlowDefinitions.CapabilitiesSchema("serverless-function"),
                Label = "Serverless Function",
                Category = "compute",
                DefaultCapacity = 500,
                DefaultQueueLimit = 50,
                MonthlyCost = 100,
                Emoji = "⚡",
                Description = "On-demand function execution (Lambda/Cloud Functions)",
                Width = 160,
                Height = 72,
                Enabled = true
            },
            new() {
                Id = Guid.NewGuid(),
                ComponentType = "container",
                ConfigSchema = FlowDefinitions.CapabilitiesSchema("container"),
                Label = "Container",
                Category = "compute",
                DefaultCapacity = 200,
                DefaultQueueLimit = 100,
                MonthlyCost = 150,
                Emoji = "📦",
                Description = "Containerized application instance",
                Width = 130,
                Height = 72,
                Enabled = true
            },
            
            // Storage
            new() {
                Id = Guid.NewGuid(),
                ComponentType = "database",
                ConfigSchema = FlowDefinitions.CapabilitiesSchema("database"),
                Label = "SQL Database",
                Category = "storage",
                DefaultCapacity = 140,
                DefaultQueueLimit = 60,
                MonthlyCost = 350,
                Emoji = "🗄️",
                Description = "Relational database (PostgreSQL, MySQL)",
                Width = 130,
                Height = 72,
                Enabled = true
            },
            new() {
                Id = Guid.NewGuid(),
                ComponentType = "redis",
                ConfigSchema = FlowDefinitions.CapabilitiesSchema("redis"),
                Label = "Redis Cache",
                Category = "storage",
                DefaultCapacity = 900,
                DefaultQueueLimit = 150,
                MonthlyCost = 90,
                Emoji = "⚡",
                Description = "In-memory data store for caching",
                Width = 130,
                Height = 72,
                Enabled = true
            },
            new() {
                Id = Guid.NewGuid(),
                ComponentType = "nosql-database",
                ConfigSchema = FlowDefinitions.CapabilitiesSchema("nosql-database"),
                Label = "NoSQL Database",
                Category = "storage",
                DefaultCapacity = 180,
                DefaultQueueLimit = 80,
                MonthlyCost = 300,
                Emoji = "💾",
                Description = "Document/key-value store (MongoDB, DynamoDB)",
                Width = 150,
                Height = 72,
                Enabled = true
            },
            new() {
                Id = Guid.NewGuid(),
                ComponentType = "object-storage",
                ConfigSchema = FlowDefinitions.CapabilitiesSchema("object-storage"),
                Label = "Object Storage",
                Category = "storage",
                DefaultCapacity = 1000,
                DefaultQueueLimit = 200,
                MonthlyCost = 50,
                Emoji = "☁️",
                Description = "Blob storage for files and large objects (S3, Azure Blob)",
                Width = 150,
                Height = 72,
                Enabled = true
            },
            new() {
                Id = Guid.NewGuid(),
                ComponentType = "file-system",
                ConfigSchema = FlowDefinitions.CapabilitiesSchema("file-system"),
                Label = "File System",
                Category = "storage",
                DefaultCapacity = 500,
                DefaultQueueLimit = 150,
                MonthlyCost = 100,
                Emoji = "📁",
                Description = "Network file system storage",
                Width = 140,
                Height = 72,
                Enabled = true
            },
            
            // Messaging
            new() {
                Id = Guid.NewGuid(),
                ComponentType = "message-queue",
                ConfigSchema = FlowDefinitions.CapabilitiesSchema("message-queue"),
                Label = "Message Queue",
                Category = "messaging",
                DefaultCapacity = 300,
                DefaultQueueLimit = 500,
                MonthlyCost = 120,
                Emoji = "📬",
                Description = "Generic message queue for async communication",
                Width = 150,
                Height = 72,
                Enabled = true
            },
            new() {
                Id = Guid.NewGuid(),
                ComponentType = "kafka",
                ConfigSchema = FlowDefinitions.CapabilitiesSchema("kafka"),
                Label = "Kafka",
                Category = "messaging",
                DefaultCapacity = 500,
                DefaultQueueLimit = 1000,
                MonthlyCost = 250,
                Emoji = "🔀",
                Description = "Distributed event streaming platform",
                Width = 130,
                Height = 72,
                Enabled = true
            },
            new() {
                Id = Guid.NewGuid(),
                ComponentType = "rabbitmq",
                ConfigSchema = FlowDefinitions.CapabilitiesSchema("rabbitmq"),
                Label = "RabbitMQ",
                Category = "messaging",
                DefaultCapacity = 400,
                DefaultQueueLimit = 800,
                MonthlyCost = 180,
                Emoji = "🐰",
                Description = "Message broker with multiple messaging patterns",
                Width = 140,
                Height = 72,
                Enabled = true
            },
            new() {
                Id = Guid.NewGuid(),
                ComponentType = "pubsub",
                ConfigSchema = FlowDefinitions.CapabilitiesSchema("pubsub"),
                Label = "Pub/Sub",
                Category = "messaging",
                DefaultCapacity = 600,
                DefaultQueueLimit = 1000,
                MonthlyCost = 150,
                Emoji = "📡",
                Description = "Publish-subscribe messaging service",
                Width = 130,
                Height = 72,
                Enabled = true
            },
            
            // Infrastructure
            new() {
                Id = Guid.NewGuid(),
                ComponentType = "rate-limiter",
                ConfigSchema = FlowDefinitions.CapabilitiesSchema("rate-limiter"),
                Label = "Rate Limiter",
                Category = "infrastructure",
                DefaultCapacity = 2000,
                DefaultQueueLimit = 50,
                MonthlyCost = 60,
                Emoji = "🚦",
                Description = "Controls request rate to prevent abuse",
                Width = 140,
                Height = 72,
                Enabled = true
            },
            new() {
                Id = Guid.NewGuid(),
                ComponentType = "auth-service",
                ConfigSchema = FlowDefinitions.CapabilitiesSchema("auth-service"),
                Label = "Auth Service",
                Category = "infrastructure",
                DefaultCapacity = 800,
                DefaultQueueLimit = 100,
                MonthlyCost = 180,
                Emoji = "🔐",
                Description = "Authentication and authorization service",
                Width = 150,
                Height = 72,
                Enabled = true
            },
            new() {
                Id = Guid.NewGuid(),
                ComponentType = "monitoring",
                ConfigSchema = FlowDefinitions.CapabilitiesSchema("monitoring"),
                Label = "Monitoring",
                Category = "infrastructure",
                DefaultCapacity = 5000,
                DefaultQueueLimit = 500,
                MonthlyCost = 200,
                Emoji = "📊",
                Description = "Observability and monitoring service",
                Width = 140,
                Height = 72,
                Enabled = true
            },
            new() {
                Id = Guid.NewGuid(),
                ComponentType = "search-service",
                ConfigSchema = FlowDefinitions.CapabilitiesSchema("search-service"),
                Label = "Search Service",
                Category = "infrastructure",
                DefaultCapacity = 300,
                DefaultQueueLimit = 100,
                MonthlyCost = 250,
                Emoji = "🔎",
                Description = "Full-text search engine (Elasticsearch)",
                Width = 150,
                Height = 72,
                Enabled = true
            }
        };
        
        context.ComponentDefinitions.AddRange(components);
    }
    
    private static void SeedChallenges(ApplicationDbContext context)
    {
        var challenges = new List<(Challenge challenge, Scenario scenario, List<string> components)>
        {
            CreateUrlShortenerChallenge(),
            CreateDropboxChallenge(),
            CreateInstagramChallenge(),
            CreateRateLimiterChallenge()
        };
        
        foreach (var (challenge, scenario, components) in challenges)
        {
            context.Challenges.Add(challenge);
            context.Scenarios.Add(scenario);
            
            foreach (var componentType in components)
            {
                context.ChallengeComponents.Add(new ChallengeComponent
                {
                    ChallengeId = challenge.Id,
                    ComponentType = componentType
                });
            }
        }
    }
    
    private static (Challenge, Scenario, List<string>) CreateUrlShortenerChallenge()
    {
        var challengeId = Guid.NewGuid();
        var challenge = new Challenge
        {
            Id = challengeId,
            Name = "URL Shortener",
            Slug = "url-shortener",
            Description = "Design a high-traffic URL shortening service like bit.ly",
            Difficulty = "medium",
            OverviewContent = GetChallengeContent()["url-shortener"].Overview,
            VideoUrl = GetChallengeContent()["url-shortener"].VideoUrl,
        };
        
        var scenario = new Scenario
        {
            Id = Guid.NewGuid(),
            ChallengeId = challengeId,
            DurationSeconds = 45,
            BaseRps = 200,
            SpikeMultiplier = 3.2m,
            SpikeChance = 0.08m,
            ReadRatio = 0.72m,
            ScenarioConfig = JsonSerializer.Serialize(new
            {
                requirements = new[]
                {
                    "Very high sustained load — millions of redirects per day",
                    "Traffic spikes during viral events (celebrity links)",
                    "Mixed request types: creates (shorten) and reads (redirect)",
                    "Colored requests = different original URLs — a few go viral",
                    "Goal: keep every component healthy for the full simulation"
                },
                drainDuration = 10,
                pattern = "spike",
                requestTypes = new { read = 0.72, create = 0.28 },
                characteristics = new { celebrityShare = 0.82 },
                // Flow correctness (docs/specs/flow-authoring.md §2.1)
                flows = FlowDefinitions.Flows("url-shortener"),
                objectives = FlowDefinitions.ObjectivesFor("url-shortener")
            }),
            ScoringWeights = JsonSerializer.Serialize(new
            {
                availability = 40,
                latency = 30,
                scalability = 20,
                cost = 10
            })
        };
        
        var components = new List<string>
        {
            "load-balancer",
            "microservice",
            "backend-service",
            "database",
            "redis",
            "rate-limiter"
        };
        
        return (challenge, scenario, components);
    }
    
    private static (Challenge, Scenario, List<string>) CreateDropboxChallenge()
    {
        var challengeId = Guid.NewGuid();
        var challenge = new Challenge
        {
            Id = challengeId,
            Name = "File Storage Service (Dropbox)",
            Slug = "dropbox",
            Description = "Design a cloud file storage and synchronization service",
            Difficulty = "hard",
            OverviewContent = GetChallengeContent()["dropbox"].Overview,
            VideoUrl = GetChallengeContent()["dropbox"].VideoUrl,
        };
        
        var scenario = new Scenario
        {
            Id = Guid.NewGuid(),
            ChallengeId = challengeId,
            DurationSeconds = 60,
            BaseRps = 300,
            SpikeMultiplier = 2.0m,
            SpikeChance = 0.05m,
            ReadRatio = 0.5m,
            ScenarioConfig = JsonSerializer.Serialize(new
            {
                requirements = new[]
                {
                    "Store files up to 2GB",
                    "Handle 10,000 uploads/minute",
                    "Ensure data durability (no data loss)",
                    "Efficient metadata lookups",
                    "Cross-device synchronization"
                },
                drainDuration = 15,
                pattern = "gradual",
                requestTypes = new { upload = 0.2, download = 0.5, metadata = 0.3 },
                characteristics = new { fileSize = "10MB-500MB", avgFileSize = 50 },
                // Flow correctness (docs/specs/flow-authoring.md §2.1)
                flows = FlowDefinitions.Flows("dropbox"),
                objectives = FlowDefinitions.ObjectivesFor("dropbox")
            }),
            ScoringWeights = JsonSerializer.Serialize(new
            {
                durability = 35,
                storageEfficiency = 25,
                bandwidth = 20,
                cost = 20
            })
        };
        
        var components = new List<string>
        {
            "load-balancer",
            "api-gateway",
            "backend-service",
            "database",
            "nosql-database",
            "object-storage",
            "redis",
            "message-queue",
            "worker-service"
        };
        
        return (challenge, scenario, components);
    }
    
    private static (Challenge, Scenario, List<string>) CreateInstagramChallenge()
    {
        var challengeId = Guid.NewGuid();
        var challenge = new Challenge
        {
            Id = challengeId,
            Name = "Instagram Feed",
            Slug = "instagram-feed",
            Description = "Design a social media feed generation system",
            Difficulty = "hard",
            OverviewContent = GetChallengeContent()["instagram-feed"].Overview,
            VideoUrl = GetChallengeContent()["instagram-feed"].VideoUrl,
        };
        
        var scenario = new Scenario
        {
            Id = Guid.NewGuid(),
            ChallengeId = challengeId,
            DurationSeconds = 50,
            BaseRps = 400,
            SpikeMultiplier = 4.0m,
            SpikeChance = 0.12m,
            ReadRatio = 0.95m,
            ScenarioConfig = JsonSerializer.Serialize(new
            {
                requirements = new[]
                {
                    "Extremely high read volume",
                    "Fast feed generation (< 200ms)",
                    "Handle millions of users",
                    "Media storage and delivery",
                    "Real-time updates"
                },
                drainDuration = 10,
                pattern = "spike",
                requestTypes = new { feedLoad = 0.85, post = 0.05, like = 0.10 },
                characteristics = new { hotDataRatio = 0.9 },
                // Flow correctness (docs/specs/flow-authoring.md §2.1)
                flows = FlowDefinitions.Flows("instagram-feed"),
                objectives = FlowDefinitions.ObjectivesFor("instagram-feed")
            }),
            ScoringWeights = JsonSerializer.Serialize(new
            {
                latency = 35,
                availability = 30,
                throughput = 25,
                cost = 10
            })
        };
        
        var components = new List<string>
        {
            "load-balancer",
            "cdn",
            "backend-service",
            "database",
            "nosql-database",
            "redis",
            "object-storage",
            "kafka",
            "worker-service"
        };
        
        return (challenge, scenario, components);
    }
    
    private static (Challenge, Scenario, List<string>) CreateRateLimiterChallenge()
    {
        var challengeId = Guid.NewGuid();
        var challenge = new Challenge
        {
            Id = challengeId,
            Name = "Rate Limiter",
            Slug = "rate-limiter",
            Description = "Design a distributed rate limiting service",
            Difficulty = "easy",
            OverviewContent = GetChallengeContent()["rate-limiter"].Overview,
            VideoUrl = GetChallengeContent()["rate-limiter"].VideoUrl,
        };
        
        var scenario = new Scenario
        {
            Id = Guid.NewGuid(),
            ChallengeId = challengeId,
            DurationSeconds = 40,
            BaseRps = 300,
            SpikeMultiplier = 5.0m,
            SpikeChance = 0.15m,
            ReadRatio = 1.0m,
            ScenarioConfig = JsonSerializer.Serialize(new
            {
                requirements = new[]
                {
                    "Block requests exceeding rate limits",
                    "Support multiple rate limit policies",
                    "Low latency overhead (< 10ms)",
                    "Handle burst traffic",
                    "Distributed counting"
                },
                drainDuration = 5,
                pattern = "spike",
                requestTypes = new { check = 1.0 },
                characteristics = new { },
                // Flow correctness (docs/specs/flow-authoring.md §2.1)
                flows = FlowDefinitions.Flows("rate-limiter"),
                objectives = FlowDefinitions.ObjectivesFor("rate-limiter")
            }),
            ScoringWeights = JsonSerializer.Serialize(new
            {
                latency = 40,
                accuracy = 30,
                throughput = 20,
                cost = 10
            })
        };
        
        var components = new List<string>
        {
            "load-balancer",
            "rate-limiter",
            "backend-service",
            "redis",
            "database"
        };
        
        return (challenge, scenario, components);
    }
}
