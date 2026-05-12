package com.movie.ticket.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

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
        boolean autoLogin,
        String userToken,
        boolean mockEnabled
) {
}
