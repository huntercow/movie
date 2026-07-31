package com.movie.ticket.entity;

import com.fasterxml.jackson.annotation.JsonCreator;

public enum XianyuVerificationFailureCode {
    ADJUST_PRICE_REJECTED,
    ORDER_DETAIL_REQUEST_FAILED,
    ORDER_DETAIL_PROTOCOL_ERROR,
    ORDER_ID_MISMATCH,
    AMOUNT_MISMATCH,
    NON_ZERO_POST_FEE,
    MISSING_ADJUSTMENT;

    @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
    public static XianyuVerificationFailureCode fromJson(Object value) {
        if (!(value instanceof String name)) {
            throw new IllegalArgumentException("xianyu verification failure code must be a string");
        }
        return valueOf(name);
    }
}
