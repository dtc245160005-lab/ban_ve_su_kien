using System.Security.Claims;

namespace TaskT25.Api.Services;

public interface ICurrentUserContext
{
    bool TryGetCurrentUserId(out int userId);
}

public sealed class AspNetCurrentUserContext : ICurrentUserContext
{
    private readonly IHttpContextAccessor _httpContextAccessor;
    private readonly IWebHostEnvironment _environment;

    public AspNetCurrentUserContext(
        IHttpContextAccessor httpContextAccessor,
        IWebHostEnvironment environment)
    {
        _httpContextAccessor = httpContextAccessor;
        _environment = environment;
    }

    public bool TryGetCurrentUserId(out int userId)
    {
        var user = _httpContextAccessor.HttpContext?.User;
        var claim = user?.FindFirst(ClaimTypes.NameIdentifier) ?? user?.FindFirst("sub");

        if (claim is not null && int.TryParse(claim.Value, out userId))
        {
            return true;
        }

        var context = _httpContextAccessor.HttpContext;
        if (_environment.IsDevelopment()
            && context?.Request.Headers.TryGetValue("X-Demo-User-Id", out var demoUserId) == true
            && int.TryParse(demoUserId, out userId))
        {
            return true;
        }

        userId = default;
        return false;
    }
}
