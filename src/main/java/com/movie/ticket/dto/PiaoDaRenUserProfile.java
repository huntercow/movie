package com.movie.ticket.dto;

import java.util.List;

public record PiaoDaRenUserProfile(
        String id,
        String userName,
        Integer enable,
        String regTime,
        String openId,
        String headImg,
        String nickname,
        List<PiaoDaRenBusinessInfo> userBusinesses
) {
}
