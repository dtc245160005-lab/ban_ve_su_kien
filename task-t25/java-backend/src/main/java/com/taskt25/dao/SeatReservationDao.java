package com.taskt25.dao;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import javax.sql.DataSource;

public class SeatReservationDao {
    private final DataSource dataSource;

    public SeatReservationDao(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    public DeleteSeatReservationResult deleteOwned(int seatId, int currentUserId) throws SQLException {
        String sql = "DELETE FROM seat_reservations WHERE seat_id = ? AND user_id = ?";

        try (Connection connection = dataSource.getConnection();
             PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setInt(1, seatId);
            statement.setInt(2, currentUserId);

            int affectedRows = statement.executeUpdate();
            if (affectedRows > 0) {
                return DeleteSeatReservationResult.DELETED;
            }

            boolean seatExists = seatExistsBySeatId(seatId, connection);
            if (seatExists) {
                return DeleteSeatReservationResult.FORBIDDEN;
            }

            return DeleteSeatReservationResult.NOT_FOUND;
        }
    }

    private boolean seatExistsBySeatId(int seatId, Connection connection) throws SQLException {
        String sql = "SELECT 1 FROM seat_reservations WHERE seat_id = ? LIMIT 1";
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setInt(1, seatId);
            try (ResultSet resultSet = statement.executeQuery()) {
                return resultSet.next();
            }
        }
    }
}
