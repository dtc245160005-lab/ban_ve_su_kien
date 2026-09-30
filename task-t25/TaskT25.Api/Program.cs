using TaskT25.Api.Domain;
using TaskT25.Api.Endpoints;
using TaskT25.Api.Repositories;
using TaskT25.Api.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddHttpContextAccessor();

builder.Services.AddSingleton<ISeatReservationRepository, InMemorySeatReservationRepository>();
builder.Services.AddScoped<ICurrentUserContext, AspNetCurrentUserContext>();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();
app.MapSeatReservationEndpoints();

if (app.Environment.IsDevelopment())
{
    var repo = app.Services.GetRequiredService<ISeatReservationRepository>();
    repo.Seed(
        new SeatReservation { SeatId = 10, UserId = 42 },
        new SeatReservation { SeatId = 20, UserId = 99 });
}

app.Run();

public partial class Program { }
