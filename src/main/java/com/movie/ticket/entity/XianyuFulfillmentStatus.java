package com.movie.ticket.entity;

public enum XianyuFulfillmentStatus {
    WAIT_IMAGE,
    QUOTED,
    WAIT_BUYER_PAY,
    PAID_WAIT_SUBMIT,
    TICKETING,
    ISSUED_WAIT_DELIVER,
    DELIVERY_OUTCOME_PENDING,
    DELIVERED,
    NEED_MANUAL,
    REFUNDED,
    CLOSED
}
