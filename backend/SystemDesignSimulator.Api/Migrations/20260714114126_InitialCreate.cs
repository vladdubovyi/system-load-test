using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SystemDesignSimulator.Api.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Challenges",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Slug = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Description = table.Column<string>(type: "text", nullable: true),
                    Difficulty = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "NOW()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Challenges", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ComponentDefinitions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ComponentType = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Label = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    Category = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    DefaultCapacity = table.Column<int>(type: "integer", nullable: false),
                    DefaultQueueLimit = table.Column<int>(type: "integer", nullable: false),
                    MonthlyCost = table.Column<decimal>(type: "numeric(10,2)", nullable: false),
                    ConfigSchema = table.Column<string>(type: "jsonb", nullable: true),
                    Emoji = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: true),
                    Width = table.Column<int>(type: "integer", nullable: false),
                    Height = table.Column<int>(type: "integer", nullable: false),
                    Description = table.Column<string>(type: "text", nullable: true),
                    Enabled = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ComponentDefinitions", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ChallengeComponents",
                columns: table => new
                {
                    ChallengeId = table.Column<Guid>(type: "uuid", nullable: false),
                    ComponentType = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ChallengeComponents", x => new { x.ChallengeId, x.ComponentType });
                    table.ForeignKey(
                        name: "FK_ChallengeComponents_Challenges_ChallengeId",
                        column: x => x.ChallengeId,
                        principalTable: "Challenges",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Scenarios",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ChallengeId = table.Column<Guid>(type: "uuid", nullable: false),
                    DurationSeconds = table.Column<int>(type: "integer", nullable: false),
                    BaseRps = table.Column<decimal>(type: "numeric(10,2)", nullable: false),
                    SpikeMultiplier = table.Column<decimal>(type: "numeric(5,2)", nullable: true),
                    SpikeChance = table.Column<decimal>(type: "numeric(5,4)", nullable: true),
                    ReadRatio = table.Column<decimal>(type: "numeric(5,4)", nullable: true),
                    ScenarioConfig = table.Column<string>(type: "jsonb", nullable: false),
                    ScoringWeights = table.Column<string>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Scenarios", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Scenarios_Challenges_ChallengeId",
                        column: x => x.ChallengeId,
                        principalTable: "Challenges",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Challenges_Slug",
                table: "Challenges",
                column: "Slug",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ComponentDefinitions_ComponentType",
                table: "ComponentDefinitions",
                column: "ComponentType");

            migrationBuilder.CreateIndex(
                name: "IX_Scenarios_ChallengeId",
                table: "Scenarios",
                column: "ChallengeId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ChallengeComponents");

            migrationBuilder.DropTable(
                name: "ComponentDefinitions");

            migrationBuilder.DropTable(
                name: "Scenarios");

            migrationBuilder.DropTable(
                name: "Challenges");
        }
    }
}
