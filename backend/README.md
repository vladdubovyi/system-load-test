# System Design Simulator - Backend API

ASP.NET Core Web API for the System Design Simulator platform.

## Technology Stack

- **.NET 8.0**
- **ASP.NET Core Web API**
- **Entity Framework Core 8.0**
- **PostgreSQL 16**
- **Npgsql** (PostgreSQL provider)

## Features

- RESTful API for challenge management
- 4 pre-seeded challenges (URL Shortener, Dropbox, Instagram Feed, Rate Limiter)
- 23+ component definitions across 5 categories
- Automatic database migrations on startup
- CORS enabled for frontend integration
- Swagger/OpenAPI documentation

## Prerequisites

- .NET 8.0 SDK
- PostgreSQL 16

## Database Setup

1. Install and start PostgreSQL:
```bash
sudo apt install postgresql postgresql-contrib
sudo service postgresql start
```

2. Create database and user:
```bash
sudo -u postgres psql -c "CREATE DATABASE systemdesignsim;"
sudo -u postgres psql -c "ALTER USER postgres WITH PASSWORD 'postgres';"
```

## Running the API

1. Navigate to the API project:
```bash
cd backend/SystemDesignSimulator.Api
```

2. Run the application:
```bash
dotnet run
```

The API will start on `http://localhost:5000` and automatically:
- Apply any pending database migrations
- Seed initial challenge and component data
- Open Swagger UI at `http://localhost:5000/swagger`

## API Endpoints

### Health
- `GET /api/health` - Health check endpoint

### Challenges
- `GET /api/challenges` - Get all challenges with scenarios
- `GET /api/challenges/{id}` - Get specific challenge by ID
- `GET /api/challenges/slug/{slug}` - Get challenge by slug

### Components
- `GET /api/components` - Get all component definitions
- `GET /api/components?category={category}` - Filter by category
- `GET /api/components/{type}` - Get component by type

## Pre-seeded Challenges

1. **URL Shortener** (medium) - High-traffic URL shortening service
2. **File Storage Service / Dropbox** (hard) - Cloud file storage and sync
3. **Instagram Feed** (hard) - Social media feed generation
4. **Rate Limiter** (easy) - Distributed rate limiting service

## Component Categories

- **Networking**: Load Balancer, API Gateway, CDN, DNS, Reverse Proxy
- **Compute**: Backend Service, Microservice, Worker, Serverless Function, Container
- **Storage**: SQL Database, Redis Cache, NoSQL Database, Object Storage, File System
- **Messaging**: Message Queue, Kafka, RabbitMQ, Pub/Sub
- **Infrastructure**: Rate Limiter, Auth Service, Monitoring, Search Service

## Configuration

Update `appsettings.json` to configure the database connection:

```json
{
  "ConnectionStrings": {
    "DefaultConnection": "Host=localhost;Port=5432;Database=systemdesignsim;Username=postgres;Password=YOUR_PASSWORD"
  }
}
```

## Development

### Adding a New Migration

```bash
export PATH="$PATH:/home/ubuntu/.dotnet/tools"
dotnet ef migrations add MigrationName
```

### Removing Last Migration

```bash
dotnet ef migrations remove
```

### Manual Database Update

```bash
dotnet ef database update
```

## Project Structure

```
SystemDesignSimulator.Api/
├── Controllers/          # API controllers
│   ├── ChallengesController.cs
│   ├── ComponentsController.cs
│   └── HealthController.cs
├── Models/              # Data models
│   ├── Challenge.cs
│   ├── Scenario.cs
│   ├── ComponentDefinition.cs
│   └── ChallengeComponent.cs
├── Data/                # Database context and seeding
│   ├── ApplicationDbContext.cs
│   └── Seed/
│       └── ChallengeSeeder.cs
├── Migrations/          # EF Core migrations
└── Program.cs           # Application entry point
```

## CORS Configuration

The API is configured to allow requests from:
- `http://localhost:5173` (Vite dev server)
- `http://localhost:4173` (Vite preview)
- `https://vladdubovyi.github.io` (GitHub Pages)

Update `Program.cs` to add additional origins as needed.
