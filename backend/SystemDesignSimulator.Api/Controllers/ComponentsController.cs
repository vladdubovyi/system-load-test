using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SystemDesignSimulator.Api.Data;

namespace SystemDesignSimulator.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ComponentsController : ControllerBase
{
    private readonly ApplicationDbContext _context;
    private readonly ILogger<ComponentsController> _logger;

    public ComponentsController(ApplicationDbContext context, ILogger<ComponentsController> logger)
    {
        _context = context;
        _logger = logger;
    }

    [HttpGet]
    public async Task<IActionResult> GetComponents([FromQuery] string? category = null)
    {
        var query = _context.ComponentDefinitions.Where(c => c.Enabled);

        if (!string.IsNullOrEmpty(category))
        {
            query = query.Where(c => c.Category == category);
        }

        var components = await query
            .OrderBy(c => c.Category)
            .ThenBy(c => c.Label)
            .ToListAsync();

        var result = components.Select(c => new
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
            c.Enabled
        });

        return Ok(result);
    }

    [HttpGet("{type}")]
    public async Task<IActionResult> GetComponentByType(string type)
    {
        var component = await _context.ComponentDefinitions
            .FirstOrDefaultAsync(c => c.ComponentType == type);

        if (component == null)
        {
            return NotFound(new { error = "Component not found" });
        }

        var result = new
        {
            component.Id,
            component.ComponentType,
            component.Label,
            component.Category,
            component.DefaultCapacity,
            component.DefaultQueueLimit,
            component.MonthlyCost,
            component.Emoji,
            component.Width,
            component.Height,
            component.Description,
            component.Enabled
        };

        return Ok(result);
    }
}
