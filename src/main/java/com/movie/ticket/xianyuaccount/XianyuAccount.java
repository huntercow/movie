package com.movie.ticket.xianyuaccount;

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

@Getter
@Setter
@Entity
public class XianyuAccount extends TimestampedEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Long userId;

    @Column(nullable = false, unique = true, length = 128)
    private String platformAccountId;

    @Column(length = 128)
    private String nickname;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private XianyuAccountStatus status;
}
