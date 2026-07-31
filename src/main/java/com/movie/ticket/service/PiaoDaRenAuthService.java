package com.movie.ticket.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.movie.ticket.config.UpstreamProperties;
import com.movie.ticket.dto.PiaoDaRenBusinessInfo;
import com.movie.ticket.dto.PiaoDaRenLoginRequest;
import com.movie.ticket.dto.PiaoDaRenLoginResponse;
import com.movie.ticket.dto.PiaoDaRenSmokeCheckItem;
import com.movie.ticket.dto.PiaoDaRenSmokeCheckResponse;
import com.movie.ticket.dto.PiaoDaRenStatusResponse;
import com.movie.ticket.dto.PiaoDaRenUserProfile;
import com.movie.ticket.entity.PiaoDaRenAccount;
import com.movie.ticket.exception.BusinessException;
import com.movie.ticket.repository.PiaoDaRenAccountRepository;
import com.movie.ticket.security.UserScopeContext;
import com.movie.ticket.upstream.PiaoDaRenSession;
import jakarta.annotation.PostConstruct;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

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
        accountRepository.clearStoredSecrets();
        if (properties.mockEnabled()) {
            return;
        }
        if (!properties.autoLogin()) {
            return;
        }
        if (!StringUtils.hasText(properties.userName()) || !StringUtils.hasText(properties.password())) {
            throw new IllegalStateException("upstream auto-login requires configured username and password");
        }
        login(new PiaoDaRenLoginRequest(properties.userName(), properties.password(), properties.userTypeEnum()));
    }

    public PiaoDaRenLoginResponse login(PiaoDaRenLoginRequest request) {
        Map<?, ?> response;
        try {
            response = restClient.post()
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
        } catch (RestClientException exception) {
            throw new BusinessException("upstream login request failed", exception);
        }

        if (response == null) {
            throw new BusinessException("empty login response");
        }

        int state = requiredState(response);
        if (state != 200) {
            throw new BusinessException("upstream login returned state " + state + ": " + requiredErrorMessage(response));
        }

        String token = requiredString(response, "token", "upstream login response");

        PiaoDaRenUserProfile profile = parseProfile(response);
        session.setUserToken(token);
        session.setUserProfile(profile.id(), profile.userName(), profile.nickname(), profile.headImg());
        saveAccount(profile);
        return new PiaoDaRenLoginResponse(true, token, profile);
    }

    public PiaoDaRenLoginResponse loginConfiguredAccount() {
        if (!StringUtils.hasText(properties.userName()) || !StringUtils.hasText(properties.password())) {
            throw new BusinessException("missing configured upstream username or password");
        }
        return login(new PiaoDaRenLoginRequest(properties.userName(), properties.password(), properties.userTypeEnum()));
    }

    public PiaoDaRenStatusResponse getStatus() {
        String token = resolveUserToken();
        PiaoDaRenAccount latestAccount = accountRepository.findFirstByOrderByLastLoginAtDesc().orElse(null);
        return new PiaoDaRenStatusResponse(
                requireText(properties.provider(), "upstream provider is not configured"),
                properties.mockEnabled(),
                properties.autoLogin(),
                properties.baseUrl(),
                properties.h5BaseUrl(),
                StringUtils.hasText(token),
                maskToken(token),
                session.getUserId(),
                session.getUserName(),
                session.getNickname(),
                latestAccount == null ? null : latestAccount.getLastLoginAt()
        );
    }

    public PiaoDaRenSmokeCheckResponse smokeCheck() {
        List<PiaoDaRenSmokeCheckItem> checks = new ArrayList<>();
        String token = resolveUserToken();
        boolean hasBaseUrl = StringUtils.hasText(properties.baseUrl());
        boolean hasH5BaseUrl = StringUtils.hasText(properties.h5BaseUrl());
        boolean configuredCredentials = StringUtils.hasText(properties.userName())
                && StringUtils.hasText(properties.password());

        checks.add(new PiaoDaRenSmokeCheckItem(
                "provider",
                "liangpiao-h5".equals(properties.provider()),
                "current provider: " + requireText(properties.provider(), "upstream provider is not configured")
        ));
        checks.add(new PiaoDaRenSmokeCheckItem(
                "credentials",
                configuredCredentials,
                configuredCredentials ? "configured account is present" : "missing configured upstream username or password"
        ));
        checks.add(new PiaoDaRenSmokeCheckItem(
                "token",
                StringUtils.hasText(token),
                StringUtils.hasText(token) ? "session token is available" : "not logged in; call /login/configured first"
        ));
        checks.add(checkH5Index(hasH5BaseUrl));
        checks.add(checkSafeCityList(hasBaseUrl, token));

        return new PiaoDaRenSmokeCheckResponse(
                requireText(properties.provider(), "upstream provider is not configured"),
                properties.mockEnabled(),
                configuredCredentials,
                StringUtils.hasText(token),
                properties.baseUrl(),
                properties.h5BaseUrl(),
                checks,
                List.of(
                        "GET /api/upstream/piaodaren/status",
                        "GET /api/upstream/piaodaren/h5/probe",
                        "GET /api/upstream/piaodaren/smoke",
                        "POST /api/upstream/piaodaren/login/configured"
                ),
                List.of(
                        "POST /api/quotes or image OCR quotation",
                        "upstream submitOrder",
                        "upstream payOrder",
                        "upstream cancelOrder",
                        "any real Xianyu paid-order fulfillment"
                )
        );
    }

    private void saveAccount(PiaoDaRenUserProfile profile) {
        Long userId = UserScopeContext.get();
        String storageId = userId == null ? profile.id() : userId + ":" + profile.id();
        PiaoDaRenAccount account = accountRepository.findById(storageId).orElseGet(PiaoDaRenAccount::new);
        account.setId(storageId);
        account.setUserName(profile.userName());
        account.setEnable(profile.enable());
        account.setRegTime(profile.regTime());
        account.setOpenId(profile.openId());
        account.setHeadImg(profile.headImg());
        account.setNickname(profile.nickname());
        account.setUserBusinessesJson(toJson(profile.userBusinesses()));
        account.setUserToken(null);
        account.setRawResponse(null);
        account.setLastLoginAt(LocalDateTime.now());
        accountRepository.save(account);
    }

    private String toJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new BusinessException("unable to serialize upstream user profile", exception);
        }
    }

    private PiaoDaRenUserProfile parseProfile(Map<?, ?> response) {
        Object data = response.get("data");
        if (!(data instanceof Map<?, ?> dataMap)) {
            throw new BusinessException("upstream login response data must be a JSON object");
        }
        return new PiaoDaRenUserProfile(
                requiredString(dataMap, "id", "upstream login data"),
                requiredString(dataMap, "userName", "upstream login data"),
                optionalInteger(dataMap, "enable", "upstream login data"),
                optionalString(dataMap, "regTime", "upstream login data"),
                optionalString(dataMap, "openId", "upstream login data"),
                optionalString(dataMap, "headImg", "upstream login data"),
                optionalString(dataMap, "nickname", "upstream login data"),
                parseBusinesses(dataMap.get("userBusinesses"))
        );
    }

    private List<PiaoDaRenBusinessInfo> parseBusinesses(Object value) {
        List<PiaoDaRenBusinessInfo> businesses = new ArrayList<>();
        if (value == null) {
            return businesses;
        }
        if (!(value instanceof List<?> list)) {
            throw new BusinessException("upstream login userBusinesses must be a JSON array");
        }
        for (Object item : list) {
            if (!(item instanceof Map<?, ?> itemMap)) {
                throw new BusinessException("upstream login userBusinesses item must be a JSON object");
            }
            businesses.add(new PiaoDaRenBusinessInfo(
                    requiredString(itemMap, "businessType", "upstream login userBusinesses item")
            ));
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
        throw new BusinessException("upstream user type is required");
    }

    private PiaoDaRenSmokeCheckItem checkH5Index(boolean hasH5BaseUrl) {
        if (!hasH5BaseUrl) {
            return new PiaoDaRenSmokeCheckItem("h5-index", false, "missing H5 base url");
        }
        try {
            String html = restClient.get()
                    .uri(properties.h5BaseUrl())
                    .retrieve()
                    .body(String.class);
            int length = html == null ? 0 : html.length();
            return new PiaoDaRenSmokeCheckItem(
                    "h5-index",
                    length > 0,
                    "H5 index length: " + length + ", title: " + extractTitle(html)
            );
        } catch (Exception exception) {
            return new PiaoDaRenSmokeCheckItem("h5-index", false, exception.getMessage());
        }
    }

    private PiaoDaRenSmokeCheckItem checkSafeCityList(boolean hasBaseUrl, String token) {
        if (!hasBaseUrl) {
            return new PiaoDaRenSmokeCheckItem("safe-city-list", false, "missing upstream base url");
        }
        try {
            Map<?, ?> response = restClient.get()
                    .uri(properties.baseUrl() + "/film/cinema/getCityList")
                    .header("Accept", "*/*")
                    .header("Origin", "http://h5.liangpiao.net.cn")
                    .header("Referer", "http://h5.liangpiao.net.cn/")
                    .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/132.0.0.0 Safari/537.36")
                    .header("user-token", requireText(token, "upstream login required for city-list check"))
                    .retrieve()
                    .body(Map.class);
            if (response == null) {
                throw new BusinessException("empty city-list response");
            }
            int state = requiredState(response);
            boolean passed = state == 200;
            return new PiaoDaRenSmokeCheckItem(
                    "safe-city-list",
                    passed,
                    passed
                            ? "safe city-list API returned state 200"
                            : "safe city-list API returned state " + state + ": " + requiredErrorMessage(response)
            );
        } catch (Exception exception) {
            return new PiaoDaRenSmokeCheckItem("safe-city-list", false, exception.getMessage());
        }
    }

    private String extractTitle(String html) {
        if (html == null) {
            return "";
        }
        int start = html.indexOf("<title>");
        int end = html.indexOf("</title>");
        if (start < 0 || end <= start) {
            return "";
        }
        return html.substring(start + "<title>".length(), end);
    }

    private String resolveUserToken() {
        String sessionToken = session.getUserToken();
        if (StringUtils.hasText(sessionToken)) {
            return sessionToken;
        }
        if (UserScopeContext.get() == null && StringUtils.hasText(properties.userToken())) {
            return properties.userToken();
        }
        return null;
    }

    private String requireText(String value, String message) {
        if (!StringUtils.hasText(value)) {
            throw new BusinessException(message);
        }
        return value;
    }

    private String maskToken(String token) {
        if (!StringUtils.hasText(token)) {
            return "";
        }
        if (token.length() <= 12) {
            return "***(" + token.length() + ")";
        }
        return token.substring(0, 6) + "***" + token.substring(token.length() - 4) + "(" + token.length() + ")";
    }

    private int requiredState(Map<?, ?> response) {
        Object value = response.get("state");
        if (value instanceof Number number) {
            return number.intValue();
        }
        if (value instanceof String text && text.matches("\\d{3}")) {
            return Integer.parseInt(text);
        }
        throw new BusinessException("upstream response state must be a three-digit number");
    }

    private String requiredErrorMessage(Map<?, ?> response) {
        return requiredString(response, "message", "upstream error response");
    }

    private String requiredString(Map<?, ?> source, String field, String context) {
        String value = optionalString(source, field, context);
        if (!StringUtils.hasText(value)) {
            throw new BusinessException(context + " is missing " + field);
        }
        return value;
    }

    private String optionalString(Map<?, ?> source, String field, String context) {
        Object value = source.get(field);
        if (value == null) {
            return null;
        }
        if (!(value instanceof String text)) {
            throw new BusinessException(context + " field " + field + " must be a string");
        }
        return text;
    }

    private Integer optionalInteger(Map<?, ?> source, String field, String context) {
        Object value = source.get(field);
        if (value == null) {
            return null;
        }
        if (!(value instanceof Number number)) {
            throw new BusinessException(context + " field " + field + " must be an integer");
        }
        return number.intValue();
    }
}
