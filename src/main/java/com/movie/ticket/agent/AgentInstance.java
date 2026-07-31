package com.movie.ticket.agent;

import com.movie.ticket.shared.persistence.TimestampedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDateTime;

@Getter
@Setter
@Entity
public class AgentInstance extends TimestampedEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Long userId;

    @Column(nullable = false, unique = true)
    private Long agentTokenId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private AgentType agentType;

    @Column(nullable = false, unique = true, length = 128)
    private String installationId;

    @Column(length = 128)
    private String instanceName;

    @Column(length = 64)
    private String clientVersion;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private AgentInstanceStatus status;

    @Column(nullable = false)
    private LocalDateTime activatedAt;

    private LocalDateTime lastHeartbeatAt;

    @Column(length = 128)
    private String currentXianyuAccountId;

    @Column(length = 128)
    private String currentXianyuNickname;

    private LocalDateTime xianyuAccountUpdatedAt;

    private LocalDateTime disabledAt;
}
