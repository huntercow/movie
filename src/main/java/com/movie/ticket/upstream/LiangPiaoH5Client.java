package com.movie.ticket.upstream;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.movie.ticket.config.UpstreamProperties;
import com.movie.ticket.exception.BusinessException;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

@Component
@ConditionalOnProperty(prefix = "ticket.upstream", name = "mock-enabled", havingValue = "false")
@ConditionalOnExpression("'${ticket.upstream.provider:piaodaren}' == 'liangpiao-h5'")
public class LiangPiaoH5Client extends PiaoDaRenClient {

    private final UpstreamProperties properties;
    private final RestClient restClient;

    public LiangPiaoH5Client(
            RestClient restClient,
            UpstreamProperties properties,
            PiaoDaRenSession session,
            ObjectMapper objectMapper
    ) {
        super(restClient, properties, session, objectMapper);
        this.properties = properties;
        this.restClient = restClient;
    }

    public String getH5IndexProbe() {
        if (properties.h5BaseUrl() == null || properties.h5BaseUrl().isBlank()) {
            throw new BusinessException("missing liangpiao h5 base url");
        }
        return restClient.get()
                .uri(properties.h5BaseUrl())
                .retrieve()
                .body(String.class);
    }
}
