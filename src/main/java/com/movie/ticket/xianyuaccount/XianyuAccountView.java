package com.movie.ticket.xianyuaccount;

import java.time.LocalDateTime;

public record XianyuAccountView(
        Long id,
        String platformAccountId,
        String nickname,
        XianyuAccountStatus status,
        LocalDateTime createdAt,
        LocalDateTime updatedAt
) {
    public static XianyuAccountView from(XianyuAccount account) {
        return new XianyuAccountView(
                account.getId(),
                account.getPlatformAccountId(),
                account.getNickname(),
                account.getStatus(),
                account.getCreatedAt(),
                account.getUpdatedAt()
        );
    }
}
