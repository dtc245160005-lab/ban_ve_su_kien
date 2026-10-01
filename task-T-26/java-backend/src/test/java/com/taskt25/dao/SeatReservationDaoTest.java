package com.taskt25.dao;

import org.h2.jdbcx.JdbcDataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;

import static org.junit.jupiter.api.Assertions.assertEquals;

class SeatReservationDaoTest {
    private SeatReservationDao dao;

    @BeforeEach
    void setUp() throws SQLException {
        JdbcDataSource dataSource = new JdbcDataSource();
        dataSource.setURL("jdbc:h2:mem:testdb;DB_CLOSE_DELAY=-1;MODE=MySQL");
        dataSource.setUser("sa");
        dataSource.setPassword("");

        try (Connection connection = dataSource.getConnection();
             java.sql.Statement statement = connection.createStatement()) {
            statement.execute("DROP TABLE IF EXISTS seat_reservations");
            statement.execute("CREATE TABLE seat_reservations (seat_id INT NOT NULL, user_id INT NOT NULL)");
            statement.execute("INSERT INTO seat_reservations (seat_id, user_id) VALUES (10, 42), (20, 99)");
        }

        dao = new SeatReservationDao(dataSource);
    }

    @Test
    void deleteOwned_WhenSeatBelongsToCurrentUser_DeletesReservation() throws SQLException {
        DeleteSeatReservationResult result = dao.deleteOwned(10, 42);

        assertEquals(DeleteSeatReservationResult.DELETED, result);
    }

    @Test
    void deleteOwned_WhenSeatBelongsToAnotherUser_ReturnsForbidden() throws SQLException {
        DeleteSeatReservationResult result = dao.deleteOwned(20, 42);

        assertEquals(DeleteSeatReservationResult.FORBIDDEN, result);
    }

    @Test
    void deleteOwned_WhenSeatIsNotReserved_ReturnsNotFound() throws SQLException {
        DeleteSeatReservationResult result = dao.deleteOwned(30, 42);

        assertEquals(DeleteSeatReservationResult.NOT_FOUND, result);
    }
}
