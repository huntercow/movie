package com.movie.ticket.service;

import com.movie.ticket.config.UpstreamProperties;
import com.movie.ticket.dto.PiaoDaRenLoginRequest;
import com.movie.ticket.dto.PiaoDaRenLoginResponse;
import com.movie.ticket.exception.BusinessException;
import com.movie.ticket.upstream.PiaoDaRenSession;
import jakarta.annotation.PostConstruct;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestClient;

import java.util.Map;

@Service
public class PiaoDaRenAuthService {

    private final RestClient restClient;
    private final UpstreamProperties properties;
    private final PiaoDaRenSession session;

    public PiaoDaRenAuthService(RestClient restClient, UpstreamProperties properties, PiaoDaRenSession session) {
        this.restClient = restClient;
        this.properties = properties;
        this.session = session;
    }

    @PostConstruct
    public void autoLogin() {
        if (properties.mockEnabled()) {
            return;
        }
        if (!properties.autoLogin()) {
            return;
        }
        if (!StringUtils.hasText(properties.userName()) || !StringUtils.hasText(properties.password())) {
            return;
        }
        login(new PiaoDaRenLoginRequest(properties.userName(), properties.password(), properties.userTypeEnum()));
    }

    public PiaoDaRenLoginResponse login(PiaoDaRenLoginRequest request) {
        Map<?, ?> response = restClient.post()
                .uri(requireBaseUrl() + "/login")
                .contentType(MediaType.APPLICATION_JSON)
                .header("Accept", "*/*")
                .header("Origin", "http://h5.liangpiao.net.cn")
                .header("Referer", "http://h5.liangpiao.net.cn/")
                .body(Map.of(
                        "userName", request.userName(),
                        "password", request.password(),
                        "userTypeEnum", defaultUserType(request.userTypeEnum())
                ))
                .retrieve()
                .body(Map.class);
        if (response == null) {
            throw new BusinessException("empty login response");
        }
        String token = response.get("token") == null ? null : String.valueOf(response.get("token"));
        if (!StringUtils.hasText(token)) {
            Object data = response.get("data");
            if (data instanceof Map<?, ?> dataMap && dataMap.get("token") != null) {
                token = String.valueOf(dataMap.get("token"));
            }
        }
        if (!StringUtils.hasText(token)) {
            throw new BusinessException("login succeeded but token missing: " + response);
        }
        session.setUserToken(token);
        return new PiaoDaRenLoginResponse(true, token, response);
    }

    private String requireBaseUrl() {
        if (!StringUtils.hasText(properties.baseUrl())) {
            throw new BusinessException("missing upstream base url");
        }
        return properties.baseUrl();
    }

    private String defaultUserType(String userTypeEnum) {
        if (StringUtils.hasText(userTypeEnum)) {
            return userTypeEnum;
        }
        if (StringUtils.hasText(properties.userTypeEnum())) {
            return properties.userTypeEnum();
        }
        return "Consume";
    }
}
