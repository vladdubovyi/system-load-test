# Build stage
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

# Copy csproj and restore dependencies
COPY SystemDesignSimulator.Api/*.csproj ./SystemDesignSimulator.Api/
RUN dotnet restore SystemDesignSimulator.Api/SystemDesignSimulator.Api.csproj

# Copy everything else and build
COPY SystemDesignSimulator.Api/. ./SystemDesignSimulator.Api/
WORKDIR /src/SystemDesignSimulator.Api
RUN dotnet publish -c Release -o /app/publish

# Runtime stage
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app

# Copy published app
COPY --from=build /app/publish .

# Expose port (Railway/Render will override this)
EXPOSE 5063

# Set environment to production
ENV ASPNETCORE_ENVIRONMENT=Production
ENV ASPNETCORE_URLS=http://+:5063

# Run the app
ENTRYPOINT ["dotnet", "SystemDesignSimulator.Api.dll"]
