using TaskT25.Api.Domain;

namespace TaskT25.Api.Repositories;

public enum DeleteSeatReservationResult
{
    Deleted,
    Forbidden,
    NotFound
}

public interface ISeatReservationRepository
{
    Task<DeleteSeatReservationResult> DeleteOwnedAsync(int seatId, int currentUserId, CancellationToken cancellationToken = default);
    bool Exists(int seatId);
    void Seed(params SeatReservation[] reservations);
}

public sealed class InMemorySeatReservationRepository : ISeatReservationRepository
{
    private readonly List<SeatReservation> _reservations = new();

    public void Seed(params SeatReservation[] reservations)
    {
        _reservations.AddRange(reservations);
    }

    public bool Exists(int seatId)
    {
        return _reservations.Any(r => r.SeatId == seatId);
    }

    public Task<DeleteSeatReservationResult> DeleteOwnedAsync(int seatId, int currentUserId, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();

        var removedCount = _reservations.RemoveAll(r => r.SeatId == seatId && r.UserId == currentUserId);
        if (removedCount > 0)
        {
            return Task.FromResult(DeleteSeatReservationResult.Deleted);
        }

        if (_reservations.Any(r => r.SeatId == seatId))
        {
            return Task.FromResult(DeleteSeatReservationResult.Forbidden);
        }

        return Task.FromResult(DeleteSeatReservationResult.NotFound);
    }
}
