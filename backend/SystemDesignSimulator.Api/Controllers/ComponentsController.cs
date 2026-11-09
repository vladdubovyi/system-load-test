using Microsoft.AspNetCore.Mvc;
using SystemDesignSimulator.Api.Data;
using SystemDesignSimulator.Api.Data.Seed;
using SystemDesignSimulator.Api.Models;

namespace SystemDesignSimulator.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ComponentsController : ControllerBase
{
    private readonly IChallengeCatalog _catalog;

    public ComponentsController(IChallengeCatalog catalog)
    {
        _catalog = catalog;
    }

    [HttpGet]
    public IActionResult GetComponents([FromQuery] string? category = null)
    {
        IEnumerable<ComponentDefinition> components = _catalog.Components.Where(c => c.Enabled);

        if (!string.IsNullOrEmpty(category))
        {
            components = components.Where(c => c.Category == category);
        }

        var result = components
            .OrderBy(c => c.Category, StringComparer.Ordinal)
            .ThenBy(c => c.Label, StringComparer.Ordinal)
            .Select(ToDto);

        return Ok(result);
    }

    [HttpGet("{type}")]
    public IActionResult GetComponentByType(string type)
    {
        var component = _catalog.FindComponent(type);
        return component == null
            ? NotFound(new { error = "Component not found" })
            : Ok(ToDto(component));
    }

    private static object ToDto(ComponentDefinition c) => new
    {
        c.Id,
        c.ComponentType,
        c.Label,
        c.Category,
        c.DefaultCapacity,
        c.DefaultQueueLimit,
        c.MonthlyCost,
        c.Emoji,
        c.Width,
        c.Height,
        c.Description,
        c.Enabled,
        // Semantic capabilities (docs/specs/flow-authoring.md §2.2), stored in ConfigSchema.
        Capabilities = FlowDefinitions.CapabilitiesFromSchema(c.ConfigSchema)
    };
}
