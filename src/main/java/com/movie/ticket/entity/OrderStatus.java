package com.movie.ticket.entity;

public enum OrderStatus {
    CREATED,
    WAIT_SUBMIT,
    SUBMITTING,
    SUBMITTED,
    SUBMIT_FAILED,
    WAIT_PAY,
    PAID,
    TICKETING,
    ISSUED,
    FAILED,
    REFUNDED
}
