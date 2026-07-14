using System.Text.Json;
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
    
    private static void SeedComponentDefinitions(ApplicationDbContext context)
    {
        var components = new List<ComponentDefinition>
        {
            // Networking
            new() {
                Id = Guid.NewGuid(),
                ComponentType = "load-balancer",
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
            Difficulty = "medium"
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
                characteristics = new { celebrityShare = 0.82 }
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
            Difficulty = "hard"
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
                characteristics = new { fileSize = "10MB-500MB", avgFileSize = 50 }
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
            Difficulty = "hard"
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
                characteristics = new { hotDataRatio = 0.9 }
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
            Difficulty = "easy"
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
                characteristics = new { }
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
