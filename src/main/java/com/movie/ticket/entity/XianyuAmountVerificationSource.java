package com.movie.ticket.entity;

import com.fasterxml.jackson.annotation.JsonCreator;

public enum XianyuAmountVerificationSource {
    XIANYU_ORDER_DETAIL_PRICE_INFO_AMOUNT;

    @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
    public static XianyuAmountVerificationSource fromJson(Object value) {
        if (!(value instanceof String name)) {
            throw new IllegalArgumentException("xianyu amount verification source must be a string");
        }
        return valueOf(name);
    }
}
