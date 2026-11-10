using System.Text.Json;
using SystemDesignSimulator.Api.Models;

namespace SystemDesignSimulator.Api.Data.Seed;

/// <summary>
/// Source of the challenge library (docs/specs/interview-platform.md §2.3).
/// Returns plain records that <see cref="ChallengeCatalog"/> holds in memory;
/// nothing here touches storage. IDs are derived from slugs and component
/// types so that they are the same on every start of every instance.
/// </summary>
public static class ChallengeSeeder
{
    /// <summary>
    /// A fixed "created" timestamp for the whole library. The catalog has no
    /// rows to date-stamp, and a value that changed on every boot would make
    /// the API's output differ between restarts for no reason.
    /// </summary>
    public static readonly DateTime CatalogDate = new(2026, 7, 14, 0, 0, 0, DateTimeKind.Utc);

    /// <summary>
    /// A stable GUID for a catalog entry, derived from its name. MD5 is used
    /// only as a 128-bit hash of a public string, never for security.
    /// </summary>
    public static Guid StableId(string name) =>
        new(System.Security.Cryptography.MD5.HashData(System.Text.Encoding.UTF8.GetBytes("breakit:" + name)));

    /// <summary>Every challenge, in library order, with scenario and allowed components attached.</summary>
    public static List<Challenge> Challenges()
    {
        var entries = new List<(Challenge challenge, Scenario scenario, List<string> components)>
        {
            CreateUrlShortenerChallenge(),
            CreateDropboxChallenge(),
            CreateInstagramChallenge(),
            CreateRateLimiterChallenge(),
            CreateChatMessagingChallenge(),
            CreateTicketBookingChallenge(),
            CreateSearchAutocompleteChallenge(),
            CreateRideDispatchChallenge(),
            CreateNotificationFanoutChallenge(),
            CreatePaymentWebhookChallenge()
        };

        var challenges = new List<Challenge>(entries.Count);
        foreach (var (challenge, scenario, components) in entries)
        {
            scenario.Challenge = challenge;
            challenge.Scenario = scenario;
            challenge.CreatedAt = CatalogDate;
            challenge.ChallengeComponents = components
                .Select(componentType => new ChallengeComponent
                {
                    ChallengeId = challenge.Id,
                    Challenge = challenge,
                    ComponentType = componentType
                })
                .ToList();
            challenges.Add(challenge);
        }
        return challenges;
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
        ["chat-messaging"] = (
            Overview: """
                Messaging backends are the canonical fan-out problem: one send becomes many deliveries, history reads dominate, and ordering within a conversation matters.

                **What interviewers look for**
                - Durable message storage before acknowledging a send
                - Buffering fan-out behind a queue so bursts do not stall the API
                - Caching hot conversations for the read-heavy history path
                - Sharding the message store by conversation

                **Key concepts to practice**
                - Write-ahead durability vs. delivery latency
                - Queue-backed workers as a pressure valve
                - Hot-key mitigation for group chats
                - NoSQL partitioning strategies

                Burst traffic is the test: group chats spike, and one store node will not keep up.
                """,
            VideoUrl: ""
        ),
        ["ticket-booking"] = (
            Overview: """
                Ticketing systems combine a read-heavy browse path with a write path that must never oversell — every reservation competes for the same hot rows while traffic ramps in minutes when a sale opens.

                **What interviewers look for**
                - Reservations that always reach the relational database (no cache on the write path)
                - Handling the on-sale ramp without falling over
                - Caching seat maps aggressively while keeping them honest
                - Replication and sharding to survive the rush

                **Key concepts to practice**
                - Row-level contention and idempotent writes
                - Multi-phase traffic: calm → rush → settle
                - Read replicas for browse, sharding for reserve
                - Graceful degradation under a 4× ramp

                Watch the ramp: the design that survives minute one may not survive minute two.
                """,
            VideoUrl: ""
        ),
        ["search-autocomplete"] = (
            Overview: """
                Typeahead turns every keystroke into a query. It is the most latency-sensitive read path most products have, and it comes with an asynchronous indexing pipeline on the side.

                **What interviewers look for**
                - A hot-prefix cache in front of the search index
                - Scaling the suggest tier for bursty keystroke traffic
                - Index updates that arrive through a queue and a worker
                - Keeping the index healthy while it serves queries

                **Key concepts to practice**
                - Cache hit ratio as the primary lever for latency
                - Separating the query path from the indexing path
                - Backpressure for indexing work
                - Capacity planning for 2–3× bursts

                Keystrokes are unforgiving: a slow suggest is a wrong suggest.
                """,
            VideoUrl: ""
        ),
        ["ride-dispatch"] = (
            Overview: """
                Dispatch systems take a flood of driver location pings and must still answer "who is nearest?" quickly and correctly. The two paths want different things: location writes can be lossy, matches cannot.

                **What interviewers look for**
                - Treating position updates as a stream, not as durable writes
                - A hot in-memory index of driver positions
                - Keeping the match path strict while the write path sheds load
                - Capacity for rush hour, when both paths double

                **Key concepts to practice**
                - Separating lossy telemetry from must-complete requests
                - Queues as buffers for write floods
                - Cache as the system of record for ephemeral state
                - Planning for a traffic ramp, not just spikes

                Rush hour arrives at 22 seconds. Design for it.
                """,
            VideoUrl: ""
        ),
        ["notification-fanout"] = (
            Overview: """
                A notification pipeline is pure asynchrony: an event arrives, gets logged, and a worker fans it out to delivery channels. The design question is what happens when the worker falls behind.

                **What interviewers look for**
                - A durable event log between the API and the workers
                - Workers that scale independently of the API
                - What a degraded worker does to delivery latency and loss
                - Separating the delivery pipeline from status reads

                **Key concepts to practice**
                - Buffering as a contract, not an optimization
                - Consumer-side capacity and parallelism
                - Degradation drills: half a worker, not zero
                - Read paths that stay fast while the pipeline strains

                At 15 seconds the delivery worker loses half its capacity for 12 seconds. Your pipeline should not notice.
                """,
            VideoUrl: ""
        ),
        ["payment-webhook"] = (
            Overview: """
                Payment providers deliver webhooks in storms and retry anything you drop, so the ingress must be rate-limited and every accepted event must reach the ledger exactly once.

                **What interviewers look for**
                - A rate limiter in front of the API, always
                - Idempotency keys so retries do not double-charge
                - Queue-and-worker settlement so the ledger is written at its own pace
                - A relational ledger that survives degradation

                **Key concepts to practice**
                - Admission control vs. capacity
                - Idempotent writes and duplicate detection
                - Decoupling ingress bursts from database throughput
                - Replication and sharding as headroom, not just scale

                At 20 seconds the ledger runs at half capacity for 10 seconds. Headroom is the whole lesson.
                """,
            VideoUrl: ""
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
    
    /// <summary>Every component definition the sandbox can place.</summary>
    public static List<ComponentDefinition> ComponentDefinitions()
    {
        var components = new List<ComponentDefinition>
        {
            // Networking
            new() {
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

        foreach (var component in components)
        {
            component.Id = StableId("component:" + component.ComponentType);
        }
        return components;
    }

    private static (Challenge, Scenario, List<string>) CreateUrlShortenerChallenge()
    {
        var challengeId = StableId("challenge:url-shortener");
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
            Id = StableId("scenario:url-shortener"),
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
                // hotDataRatio is explicit so the engine's cache hit ratio
                // survives the interview-mode projection, which withholds the
                // slug the frontend's legacy fallback keyed on (§6.1).
                characteristics = new { celebrityShare = 0.82, hotDataRatio = 0.97 },
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
        var challengeId = StableId("challenge:dropbox");
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
            Id = StableId("scenario:dropbox"),
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
        var challengeId = StableId("challenge:instagram-feed");
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
            Id = StableId("scenario:instagram-feed"),
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
    
    private static (Challenge, Scenario, List<string>) CreateChatMessagingChallenge()
    {
        var challengeId = StableId("challenge:chat-messaging");
        var challenge = new Challenge
        {
            Id = challengeId,
            Name = "Chat Messaging",
            Slug = "chat-messaging",
            Description = "Design a real-time messaging backend with fan-out and history",
            Difficulty = "medium",
            OverviewContent = GetChallengeContent()["chat-messaging"].Overview,
            VideoUrl = null,
        };

        var scenario = new Scenario
        {
            Id = StableId("scenario:chat-messaging"),
            ChallengeId = challengeId,
            DurationSeconds = 45,
            BaseRps = 220,
            SpikeMultiplier = 3.0m,
            SpikeChance = 0.08m,
            ReadRatio = 0.6m,
            ScenarioConfig = JsonSerializer.Serialize(new
            {
                requirements = new[]
                {
                    "Sends must land in a durable message store",
                    "Fan-out to recipients may be asynchronous — buffer it",
                    "Conversation history reads dominate; cache hot conversations",
                },
                drainDuration = 10,
                pattern = "spike",
                requestTypes = new { send = 0.4, fetch = 0.6 },
                characteristics = new { celebrityShare = 0.3, hotDataRatio = 0.9 },
                flows = FlowDefinitions.Flows("chat-messaging"),
                objectives = FlowDefinitions.ObjectivesFor("chat-messaging")
            }),
            ScoringWeights = JsonSerializer.Serialize(new { availability = 35, latency = 35, scalability = 20, cost = 10 })
        };

        var components = new List<string>
        {
            "load-balancer", "api-gateway", "backend-service", "microservice", "worker-service",
            "redis", "nosql-database", "message-queue", "kafka"
        };

        return (challenge, scenario, components);
    }

    private static (Challenge, Scenario, List<string>) CreateTicketBookingChallenge()
    {
        var challengeId = StableId("challenge:ticket-booking");
        var challenge = new Challenge
        {
            Id = challengeId,
            Name = "Ticket Booking",
            Slug = "ticket-booking",
            Description = "Design a ticketing system that survives the on-sale rush without overselling",
            Difficulty = "hard",
            OverviewContent = GetChallengeContent()["ticket-booking"].Overview,
            VideoUrl = null,
        };

        var scenario = new Scenario
        {
            Id = StableId("scenario:ticket-booking"),
            ChallengeId = challengeId,
            DurationSeconds = 50,
            BaseRps = 150,
            SpikeMultiplier = 1.5m,
            SpikeChance = 0.04m,
            ReadRatio = 0.8m,
            ScenarioConfig = JsonSerializer.Serialize(new
            {
                requirements = new[]
                {
                    "Every reservation must hit the relational database — no overselling",
                    "Browsing is read-heavy and cacheable",
                    "Traffic ramps to nearly 4× when the sale opens, then settles",
                },
                drainDuration = 10,
                pattern = "spike",
                requestTypes = new { browse = 0.8, reserve = 0.2 },
                characteristics = new { celebrityShare = 0.5, hotDataRatio = 0.85 },
                // Multi-phase traffic (product-directions.md §3.4): calm → rush → settle.
                trafficPhases = new object[]
                {
                    new { atSeconds = 0, baseRps = 150 },
                    new { atSeconds = 15, baseRps = 150 },
                    new { atSeconds = 25, baseRps = 550 },
                    new { atSeconds = 40, baseRps = 250 },
                },
                flows = FlowDefinitions.Flows("ticket-booking"),
                objectives = FlowDefinitions.ObjectivesFor("ticket-booking")
            }),
            ScoringWeights = JsonSerializer.Serialize(new { durability = 40, availability = 30, latency = 20, cost = 10 })
        };

        var components = new List<string>
        {
            "load-balancer", "api-gateway", "backend-service", "microservice",
            "redis", "database", "message-queue", "worker-service"
        };

        return (challenge, scenario, components);
    }

    private static (Challenge, Scenario, List<string>) CreateSearchAutocompleteChallenge()
    {
        var challengeId = StableId("challenge:search-autocomplete");
        var challenge = new Challenge
        {
            Id = challengeId,
            Name = "Search Autocomplete",
            Slug = "search-autocomplete",
            Description = "Design a typeahead service: every keystroke is a query",
            Difficulty = "medium",
            OverviewContent = GetChallengeContent()["search-autocomplete"].Overview,
            VideoUrl = null,
        };

        var scenario = new Scenario
        {
            Id = StableId("scenario:search-autocomplete"),
            ChallengeId = challengeId,
            DurationSeconds = 45,
            BaseRps = 380,
            SpikeMultiplier = 2.5m,
            SpikeChance = 0.1m,
            ReadRatio = 0.9m,
            ScenarioConfig = JsonSerializer.Serialize(new
            {
                requirements = new[]
                {
                    "Suggestions come from the search index, ideally via a hot-prefix cache",
                    "Index updates arrive asynchronously and must reach the search index",
                    "Keystroke traffic is bursty: expect 2.5× spikes",
                },
                drainDuration = 10,
                pattern = "spike",
                requestTypes = new { suggest = 0.9, index = 0.1 },
                characteristics = new { celebrityShare = 0.2, hotDataRatio = 0.95 },
                flows = FlowDefinitions.Flows("search-autocomplete"),
                objectives = FlowDefinitions.ObjectivesFor("search-autocomplete")
            }),
            ScoringWeights = JsonSerializer.Serialize(new { latency = 45, availability = 30, scalability = 15, cost = 10 })
        };

        var components = new List<string>
        {
            "load-balancer", "api-gateway", "backend-service", "microservice", "worker-service",
            "redis", "search-service", "message-queue", "kafka"
        };

        return (challenge, scenario, components);
    }

    private static (Challenge, Scenario, List<string>) CreateRideDispatchChallenge()
    {
        var challengeId = StableId("challenge:ride-dispatch");
        var challenge = new Challenge
        {
            Id = challengeId,
            Name = "Ride Dispatch",
            Slug = "ride-dispatch",
            Description = "Design a dispatch backend: lossy location pings, strict driver matching, and a rush hour",
            Difficulty = "hard",
            OverviewContent = GetChallengeContent()["ride-dispatch"].Overview,
            VideoUrl = null,
        };

        var scenario = new Scenario
        {
            Id = StableId("scenario:ride-dispatch"),
            ChallengeId = challengeId,
            DurationSeconds = 50,
            BaseRps = 220,
            SpikeMultiplier = 2.0m,
            SpikeChance = 0.06m,
            ReadRatio = 0.3m,
            ScenarioConfig = JsonSerializer.Serialize(new
            {
                requirements = new[]
                {
                    "Location pings land in a hot position cache — a stale position is tolerable, a lost match is not",
                    "Matches read the position cache and fall back to the trip store",
                    "Rush hour more than doubles the load for a quarter of a minute",
                },
                drainDuration = 10,
                pattern = "spike",
                requestTypes = new { locationUpdate = 0.7, match = 0.3 },
                characteristics = new { celebrityShare = 0.1, hotDataRatio = 0.9 },
                // Multi-phase traffic (product-directions.md §3.4): steady → rush hour → evening.
                trafficPhases = new object[]
                {
                    new { atSeconds = 0, baseRps = 220 },
                    new { atSeconds = 12, baseRps = 220 },
                    new { atSeconds = 22, baseRps = 480 },
                    new { atSeconds = 38, baseRps = 300 },
                },
                flows = FlowDefinitions.Flows("ride-dispatch"),
                objectives = FlowDefinitions.ObjectivesFor("ride-dispatch")
            }),
            ScoringWeights = JsonSerializer.Serialize(new { availability = 35, latency = 35, scalability = 20, cost = 10 })
        };

        var components = new List<string>
        {
            "load-balancer", "api-gateway", "backend-service", "microservice", "worker-service",
            "redis", "nosql-database", "database", "message-queue", "kafka"
        };

        return (challenge, scenario, components);
    }

    private static (Challenge, Scenario, List<string>) CreateNotificationFanoutChallenge()
    {
        var challengeId = StableId("challenge:notification-fanout");
        var challenge = new Challenge
        {
            Id = challengeId,
            Name = "Notification Fan-out",
            Slug = "notification-fanout",
            Description = "Design an async notification pipeline that keeps delivering when a worker degrades",
            Difficulty = "medium",
            OverviewContent = GetChallengeContent()["notification-fanout"].Overview,
            VideoUrl = null,
        };

        var scenario = new Scenario
        {
            Id = StableId("scenario:notification-fanout"),
            ChallengeId = challengeId,
            DurationSeconds = 50,
            BaseRps = 150,
            SpikeMultiplier = 2.0m,
            SpikeChance = 0.06m,
            ReadRatio = 0.15m,
            ScenarioConfig = JsonSerializer.Serialize(new
            {
                requirements = new[]
                {
                    "Every event is logged to a queue before a worker fans it out to a delivery channel",
                    "Status reads are cacheable and must stay fast while the pipeline strains",
                    "At 15 s the delivery worker runs at half capacity for 12 s — deliveries must still arrive",
                },
                drainDuration = 10,
                pattern = "spike",
                requestTypes = new { @event = 0.85, status = 0.15 },
                characteristics = new { celebrityShare = 0.2, hotDataRatio = 0.9 },
                // Scripted failure phase (product-directions.md §3.3): a degraded consumer.
                failureScenarios = new object[]
                {
                    new
                    {
                        id = "worker-degraded",
                        label = "Worker degraded",
                        atSeconds = 15,
                        target = new { componentType = "worker-service" },
                        type = "capacity",
                        durationSeconds = 12,
                    },
                },
                flows = FlowDefinitions.Flows("notification-fanout"),
                objectives = FlowDefinitions.ObjectivesFor("notification-fanout")
            }),
            ScoringWeights = JsonSerializer.Serialize(new { availability = 40, latency = 25, scalability = 25, cost = 10 })
        };

        var components = new List<string>
        {
            "load-balancer", "api-gateway", "backend-service", "microservice", "worker-service",
            "kafka", "message-queue", "pubsub", "redis", "nosql-database"
        };

        return (challenge, scenario, components);
    }

    private static (Challenge, Scenario, List<string>) CreatePaymentWebhookChallenge()
    {
        var challengeId = StableId("challenge:payment-webhook");
        var challenge = new Challenge
        {
            Id = challengeId,
            Name = "Payment Webhooks",
            Slug = "payment-webhook",
            Description = "Design webhook ingestion for a payments provider: rate-limited, idempotent, ledger-backed",
            Difficulty = "hard",
            OverviewContent = GetChallengeContent()["payment-webhook"].Overview,
            VideoUrl = null,
        };

        var scenario = new Scenario
        {
            Id = StableId("scenario:payment-webhook"),
            ChallengeId = challengeId,
            DurationSeconds = 45,
            BaseRps = 240,
            SpikeMultiplier = 2.0m,
            SpikeChance = 0.06m,
            ReadRatio = 0.35m,
            ScenarioConfig = JsonSerializer.Serialize(new
            {
                requirements = new[]
                {
                    "Every request passes a rate limiter before it reaches the API",
                    "Webhooks and charges are recorded in the relational ledger; a cache may hold idempotency keys",
                    "Webhook storms double the load, and at 20 s one ledger node runs at half capacity for 10 s",
                },
                drainDuration = 10,
                pattern = "spike",
                requestTypes = new { webhook = 0.65, charge = 0.35 },
                characteristics = new { celebrityShare = 0.3, hotDataRatio = 0.8 },
                // Scripted failure phase (product-directions.md §3.3): a degraded ledger.
                failureScenarios = new object[]
                {
                    new
                    {
                        id = "ledger-degraded",
                        label = "Ledger degraded",
                        atSeconds = 20,
                        target = new { componentType = "database" },
                        type = "capacity",
                        durationSeconds = 10,
                    },
                },
                flows = FlowDefinitions.Flows("payment-webhook"),
                objectives = FlowDefinitions.ObjectivesFor("payment-webhook")
            }),
            ScoringWeights = JsonSerializer.Serialize(new { durability = 40, availability = 30, latency = 20, cost = 10 })
        };

        var components = new List<string>
        {
            "load-balancer", "api-gateway", "rate-limiter", "backend-service", "microservice", "worker-service",
            "message-queue", "kafka", "redis", "database"
        };

        return (challenge, scenario, components);
    }

    private static (Challenge, Scenario, List<string>) CreateRateLimiterChallenge()
    {
        var challengeId = StableId("challenge:rate-limiter");
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
            Id = StableId("scenario:rate-limiter"),
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
