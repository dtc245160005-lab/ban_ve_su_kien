using System.Security.Claims;

namespace TaskT25.Api.Services;

public interface ICurrentUserContext
{
    bool TryGetCurrentUserId(out int userId);
}

public sealed class AspNetCurrentUserContext : ICurrentUserContext
{
    private readonly IHttpContextAccessor _httpContextAccessor;

    public AspNetCurrentUserContext(IHttpContextAccessor httpContextAccessor)
    {
        _httpContextAccessor = httpContextAccessor;
    }

    public bool TryGetCurrentUserId(out int userId)
    {
        var user = _httpContextAccessor.HttpContext?.User;
        var claim = user?.FindFirst(ClaimTypes.NameIdentifier) ?? user?.FindFirst("sub");

        if (claim is null || !int.TryParse(claim.Value, out userId))
        {
            userId = default;
            return false;
        }

        return true;
    }
}
