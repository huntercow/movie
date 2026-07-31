package com.movie.ticket.audit;

import java.time.LocalDateTime;

public record AuditLogView(
        Long id,
        Long actorUserId,
        Long targetUserId,
        String action,
        String resourceType,
        String resourceId,
        String beforeJson,
        String afterJson,
        String ipAddress,
        LocalDateTime createdAt
) {
    public static AuditLogView from(AuditLog log) {
        return new AuditLogView(
                log.getId(), log.getActorUserId(), log.getTargetUserId(), log.getAction(),
                log.getResourceType(), log.getResourceId(), log.getBeforeJson(), log.getAfterJson(),
                log.getIpAddress(), log.getCreatedAt()
        );
    }
}
