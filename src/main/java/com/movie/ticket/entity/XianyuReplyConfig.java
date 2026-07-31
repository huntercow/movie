package com.movie.ticket.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDateTime;

@Getter
@Setter
@Entity
@jakarta.persistence.EntityListeners(com.movie.ticket.shared.persistence.UserScopeEntityListener.class)
public class XianyuReplyConfig implements com.movie.ticket.shared.persistence.UserScopedEntity {

    @Id
    @Column(length = 64)
    private String configKey;

    @Column(name = "user_id")
    private Long userId;

    @Lob
    private String templatesJson;

    @Lob
    private String keywordRulesJson;

    @Column(nullable = false)
    private boolean textFallbackEnabled;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    @Column(nullable = false)
    private LocalDateTime updatedAt;

    @PrePersist
    void prePersist() {
        LocalDateTime now = LocalDateTime.now();
        createdAt = now;
        updatedAt = now;
    }

    @PreUpdate
    void preUpdate() {
        updatedAt = LocalDateTime.now();
    }
}
