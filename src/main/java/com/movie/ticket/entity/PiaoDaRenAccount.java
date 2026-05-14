package com.movie.ticket.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDateTime;

@Getter
@Setter
@Entity
public class PiaoDaRenAccount {

    @Id
    @Column(length = 64)
    private String id;

    @Column(length = 64)
    private String userName;

    private Integer enable;

    @Column(length = 32)
    private String regTime;

    @Column(length = 128)
    private String openId;

    @Column(length = 512)
    private String headImg;

    @Column(length = 128)
    private String nickname;

    @Column(length = 1024)
    private String userBusinessesJson;

    @Column(length = 128)
    private String userToken;

    @Lob
    private String rawResponse;

    private LocalDateTime lastLoginAt;
}
