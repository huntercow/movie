package com.movie.ticket.agent.api;

import com.movie.ticket.agent.AgentInstance;
import com.movie.ticket.agent.AgentInstanceStatus;

import java.time.LocalDateTime;

public record AgentInstanceView(
        Long id,
        String installationId,
        String instanceName,
        String clientVersion,
        AgentInstanceStatus status,
        LocalDateTime activatedAt,
        LocalDateTime lastHeartbeatAt,
        String currentXianyuAccountId,
        String currentXianyuNickname,
        LocalDateTime xianyuAccountUpdatedAt
) {
    public static AgentInstanceView from(AgentInstance instance) {
        if (instance == null) {
            return null;
        }
        return new AgentInstanceView(
                instance.getId(),
                instance.getInstallationId(),
                instance.getInstanceName(),
                instance.getClientVersion(),
                instance.getStatus(),
                instance.getActivatedAt(),
                instance.getLastHeartbeatAt(),
                instance.getCurrentXianyuAccountId(),
                instance.getCurrentXianyuNickname(),
                instance.getXianyuAccountUpdatedAt()
        );
    }
}
