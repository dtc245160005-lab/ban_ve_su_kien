package com.taskt25.web;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.taskt25.api.ApiException;
import com.taskt25.api.ErrorResponse;
import com.taskt25.dao.DeleteSeatReservationResult;
import com.taskt25.dao.SeatReservationDao;
import javax.servlet.ServletException;
import javax.servlet.annotation.WebServlet;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import org.h2.jdbcx.JdbcDataSource;

import java.io.IOException;
import java.sql.SQLException;

@WebServlet(name = "SeatReservationServlet", urlPatterns = "/seat-reservations/*")
public class SeatReservationServlet extends HttpServlet {
    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();
    private SeatReservationDao seatReservationDao;

    @Override
    public void init() throws ServletException {
        JdbcDataSource dataSource = new JdbcDataSource();
        dataSource.setURL("jdbc:h2:mem:seatapp;DB_CLOSE_DELAY=-1;MODE=MySQL;INIT=CREATE TABLE IF NOT EXISTS seat_reservations (seat_id INT NOT NULL, user_id INT NOT NULL);\nINSERT INTO seat_reservations (seat_id, user_id) VALUES (10, 42), (20, 99);");
        dataSource.setUser("sa");
        dataSource.setPassword("");
        seatReservationDao = new SeatReservationDao(dataSource);
    }

    @Override
    protected void doDelete(HttpServletRequest request, HttpServletResponse response) throws IOException {
        try {
            Integer seatId = parseSeatId(request);
            Integer userId = getCurrentUserId(request);

            if (userId == null) {
                sendError(response, HttpServletResponse.SC_UNAUTHORIZED, "UNAUTHORIZED", "User is not authenticated.", null);
                return;
            }

            DeleteSeatReservationResult result = seatReservationDao.deleteOwned(seatId, userId);

            switch (result) {
                case DELETED -> response.setStatus(HttpServletResponse.SC_OK);
                case FORBIDDEN -> sendError(response, HttpServletResponse.SC_FORBIDDEN, "FORBIDDEN",
                        "Seat " + seatId + " is reserved by another user.", null);
                case NOT_FOUND -> sendError(response, HttpServletResponse.SC_NOT_FOUND, "NOT_FOUND",
                        "Seat reservation for seat " + seatId + " was not found.", null);
                default -> sendError(response, HttpServletResponse.SC_INTERNAL_SERVER_ERROR, "UNKNOWN_ERROR",
                        "An unexpected error occurred.", null);
            }
        } catch (IllegalArgumentException e) {
            sendError(response, HttpServletResponse.SC_BAD_REQUEST, "INVALID_REQUEST", e.getMessage(), null);
        } catch (SQLException e) {
            sendError(response, HttpServletResponse.SC_INTERNAL_SERVER_ERROR, "DATABASE_ERROR", "Database error while deleting reservation.", e.getMessage());
        }
    }

    private Integer parseSeatId(HttpServletRequest request) {
        String path = request.getPathInfo();
        if (path == null || path.isBlank() || "/".equals(path)) {
            throw new IllegalArgumentException("SeatId is required.");
        }

        String seatIdParam = path.substring(1);
        try {
            return Integer.parseInt(seatIdParam);
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("SeatId must be an integer.");
        }
    }

    private Integer getCurrentUserId(HttpServletRequest request) {
        Object id = request.getSession(false) != null ? request.getSession(false).getAttribute("userId") : null;
        if (id instanceof Integer value) {
            return value;
        }
        if (id instanceof String text) {
            try {
                return Integer.parseInt(text);
            } catch (NumberFormatException ignore) {
                return null;
            }
        }
        return null;
    }

    private void sendError(HttpServletResponse response, int statusCode, String code, String message, String details) throws IOException {
        response.setStatus(statusCode);
        response.setContentType("application/json");
        response.setCharacterEncoding("UTF-8");

        ErrorResponse payload = new ErrorResponse(statusCode, code, message, details);
        response.setHeader("Cache-Control", "no-store");
        OBJECT_MAPPER.writeValue(response.getOutputStream(), payload);
    }
}
