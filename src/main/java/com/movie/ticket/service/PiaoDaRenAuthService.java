package com.movie.ticket.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.movie.ticket.config.UpstreamProperties;
import com.movie.ticket.dto.PiaoDaRenBusinessInfo;
import com.movie.ticket.dto.PiaoDaRenLoginRequest;
import com.movie.ticket.dto.PiaoDaRenLoginResponse;
import com.movie.ticket.dto.PiaoDaRenUserProfile;
import com.movie.ticket.entity.PiaoDaRenAccount;
import com.movie.ticket.exception.BusinessException;
import com.movie.ticket.repository.PiaoDaRenAccountRepository;
import com.movie.ticket.upstream.PiaoDaRenSession;
import jakarta.annotation.PostConstruct;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestClient;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Service
public class PiaoDaRenAuthService {

    private final RestClient restClient;
    private final UpstreamProperties properties;
    private final PiaoDaRenSession session;
    private final PiaoDaRenAccountRepository accountRepository;
    private final ObjectMapper objectMapper;

    public PiaoDaRenAuthService(
            RestClient restClient,
            UpstreamProperties properties,
            PiaoDaRenSession session,
            PiaoDaRenAccountRepository accountRepository,
            ObjectMapper objectMapper
    ) {
        this.restClient = restClient;
        this.properties = properties;
        this.session = session;
        this.accountRepository = accountRepository;
        this.objectMapper = objectMapper;
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
        PiaoDaRenUserProfile profile = parseProfile(response);
        session.setUserToken(token);
        if (profile != null) {
            session.setUserProfile(profile.id(), profile.userName(), profile.nickname(), profile.headImg());
            saveAccount(profile, token, response);
        }
        return new PiaoDaRenLoginResponse(true, token, profile, response);
    }

    private void saveAccount(PiaoDaRenUserProfile profile, String token, Map<?, ?> response) {
        if (!StringUtils.hasText(profile.id())) {
            return;
        }
        PiaoDaRenAccount account = accountRepository.findById(profile.id()).orElseGet(PiaoDaRenAccount::new);
        account.setId(profile.id());
        account.setUserName(profile.userName());
        account.setEnable(profile.enable());
        account.setRegTime(profile.regTime());
        account.setOpenId(profile.openId());
        account.setHeadImg(profile.headImg());
        account.setNickname(profile.nickname());
        account.setUserBusinessesJson(toJson(profile.userBusinesses()));
        account.setUserToken(token);
        account.setRawResponse(toJson(response));
        account.setLastLoginAt(LocalDateTime.now());
        accountRepository.save(account);
    }

    private String toJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            return String.valueOf(value);
        }
    }

    private PiaoDaRenUserProfile parseProfile(Map<?, ?> response) {
        Object data = response.get("data");
        if (!(data instanceof Map<?, ?> dataMap)) {
            return null;
        }
        return new PiaoDaRenUserProfile(
                stringValue(dataMap.get("id")),
                stringValue(dataMap.get("userName")),
                intValue(dataMap.get("enable")),
                stringValue(dataMap.get("regTime")),
                stringValue(dataMap.get("openId")),
                stringValue(dataMap.get("headImg")),
                stringValue(dataMap.get("nickname")),
                parseBusinesses(dataMap.get("userBusinesses"))
        );
    }

    private List<PiaoDaRenBusinessInfo> parseBusinesses(Object value) {
        List<PiaoDaRenBusinessInfo> businesses = new ArrayList<>();
        if (value instanceof List<?> list) {
            for (Object item : list) {
                if (item instanceof Map<?, ?> itemMap) {
                    businesses.add(new PiaoDaRenBusinessInfo(stringValue(itemMap.get("businessType"))));
                }
            }
        }
        return businesses;
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

    private String stringValue(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private Integer intValue(Object value) {
        if (value == null) {
            return null;
        }
        try {
            return Integer.valueOf(String.valueOf(value));
        } catch (NumberFormatException exception) {
            return null;
        }
    }
}
