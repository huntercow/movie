package com.movie.ticket.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.util.unit.DataSize;

import java.time.Duration;

@ConfigurationProperties(prefix = "ticket.upstream")
public record UpstreamProperties(
        String baseUrl,
        String ocrPath,
        String quotePath,
        String ossRegion,
        String ossBucket,
        String ossAccessKeyId,
        String ossAccessKeySecret,
        String ossUploadDir,
        String userName,
        String password,
        String userTypeEnum,
        String provider,
        String h5BaseUrl,
        Duration connectTimeout,
        Duration readTimeout,
        DataSize maxImageSize,
        boolean autoLogin,
        String userToken,
        boolean mockEnabled
) {
}
