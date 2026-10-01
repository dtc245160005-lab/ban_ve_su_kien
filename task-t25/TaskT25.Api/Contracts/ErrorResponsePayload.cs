namespace TaskT25.Api.Contracts;

public sealed record ErrorResponsePayload(
    int StatusCode,
    string Code,
    string Message,
    string? Details = null,
    string? TraceId = null);
