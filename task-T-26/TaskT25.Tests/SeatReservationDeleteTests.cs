using TaskT25.Api.Contracts;
using TaskT25.Api.Domain;
using TaskT25.Api.Repositories;

namespace TaskT25.Tests;

public class SeatReservationDeleteTests
{
    [Fact]
    public async Task DeleteOwnedAsync_WhenSeatBelongsToCurrentUser_DeletesReservation()
    {
        var repository = new InMemorySeatReservationRepository();
        repository.Seed(new SeatReservation { SeatId = 10, UserId = 42 });

        var result = await repository.DeleteOwnedAsync(10, 42);

        Assert.Equal(DeleteSeatReservationResult.Deleted, result);
        Assert.False(repository.Exists(10));
    }

    [Fact]
    public async Task DeleteOwnedAsync_WhenSeatBelongsToAnotherUser_ReturnsForbidden()
    {
        var repository = new InMemorySeatReservationRepository();
        repository.Seed(new SeatReservation { SeatId = 20, UserId = 99 });

        var result = await repository.DeleteOwnedAsync(20, 42);

        Assert.Equal(DeleteSeatReservationResult.Forbidden, result);
        Assert.True(repository.Exists(20));
    }

    [Fact]
    public async Task DeleteOwnedAsync_WhenSeatIsNotReserved_ReturnsNotFound()
    {
        var repository = new InMemorySeatReservationRepository();

        var result = await repository.DeleteOwnedAsync(30, 42);

        Assert.Equal(DeleteSeatReservationResult.NotFound, result);
    }
}
