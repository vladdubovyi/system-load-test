# Build context: repository root (Railway uses repo root when dockerfilePath = backend/Dockerfile)
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

COPY backend/SystemDesignSimulator.Api/*.csproj ./SystemDesignSimulator.Api/
RUN dotnet restore SystemDesignSimulator.Api/SystemDesignSimulator.Api.csproj

COPY backend/SystemDesignSimulator.Api/. ./SystemDesignSimulator.Api/
WORKDIR /src/SystemDesignSimulator.Api
RUN dotnet publish -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app

COPY --from=build /app/publish .

ENV ASPNETCORE_ENVIRONMENT=Production

# Shell form so $PORT is expanded at runtime (Railway injects PORT)
ENTRYPOINT ["sh", "-c", "exec dotnet SystemDesignSimulator.Api.dll --urls \"http://0.0.0.0:${PORT:-8080}\""]
