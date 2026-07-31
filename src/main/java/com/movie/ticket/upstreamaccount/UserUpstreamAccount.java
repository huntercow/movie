package com.movie.ticket.upstreamaccount;

import com.movie.ticket.shared.persistence.TimestampedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDateTime;

@Getter
@Setter
@Entity
public class UserUpstreamAccount extends TimestampedEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true)
    private Long userId;

    @Column(nullable = false, length = 64)
    private String provider;

    @Lob
    @Column(nullable = false)
    private String usernameEncrypted;

    @Lob
    @Column(nullable = false)
    private String passwordEncrypted;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private UpstreamAccountStatus status;

    private LocalDateTime lastLoginAt;

    @Column(length = 1024)
    private String lastError;
}
