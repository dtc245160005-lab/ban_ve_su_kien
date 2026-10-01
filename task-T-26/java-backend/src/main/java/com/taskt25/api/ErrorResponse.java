package com.taskt25.api;

public class ErrorResponse {
    private final int statusCode;
    private final String code;
    private final String message;
    private final String details;

    public ErrorResponse(int statusCode, String code, String message, String details) {
        this.statusCode = statusCode;
        this.code = code;
        this.message = message;
        this.details = details;
    }

    public int getStatusCode() {
        return statusCode;
    }

    public String getCode() {
        return code;
    }

    public String getMessage() {
        return message;
    }

    public String getDetails() {
        return details;
    }
}
