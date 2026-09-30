using Microsoft.AspNetCore.Http;
using TaskT25.Api.Contracts;
using TaskT25.Api.Repositories;
using TaskT25.Api.Services;

namespace TaskT25.Api.Endpoints;

public static class SeatReservationEndpoints
{
    public static void MapSeatReservationEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapDelete("/api/seat-reservations/{seatId:int}", async (
            int seatId,
            ISeatReservationRepository repository,
            ICurrentUserContext currentUserContext,
            HttpContext httpContext,
            CancellationToken cancellationToken) =>
        {
            if (!currentUserContext.TryGetCurrentUserId(out var currentUserId))
            {
                return Results.Json(
                    new ErrorResponsePayload(
                        StatusCodes.Status401Unauthorized,
                        "UNAUTHORIZED",
                        "User is not authenticated."),
                    statusCode: StatusCodes.Status401Unauthorized);
            }

            var result = await repository.DeleteOwnedAsync(seatId, currentUserId, cancellationToken);

            return result switch
            {
                DeleteSeatReservationResult.Deleted => Results.Ok(),
                DeleteSeatReservationResult.Forbidden => Results.Json(
                    new ErrorResponsePayload(
                        StatusCodes.Status403Forbidden,
                        "FORBIDDEN",
                        $"Seat {seatId} is reserved by another user."),
                    statusCode: StatusCodes.Status403Forbidden),
                DeleteSeatReservationResult.NotFound => Results.Json(
                    new ErrorResponsePayload(
                        StatusCodes.Status404NotFound,
                        "NOT_FOUND",
                        $"Seat reservation for seat {seatId} was not found."),
                    statusCode: StatusCodes.Status404NotFound),
                _ => Results.Json(
                    new ErrorResponsePayload(
                        StatusCodes.Status500InternalServerError,
                        "UNKNOWN_ERROR",
                        "An unexpected error occurred."),
                    statusCode: StatusCodes.Status500InternalServerError)
            };
        });
    }
}
