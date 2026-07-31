package com.movie.ticket.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.movie.ticket.dto.XianyuReplyConfigRequest;
import com.movie.ticket.dto.XianyuReplyConfigResponse;
import com.movie.ticket.entity.XianyuReplyConfig;
import com.movie.ticket.exception.BusinessException;
import com.movie.ticket.repository.XianyuReplyConfigRepository;
import com.movie.ticket.security.UserScopeContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class XianyuReplyConfigService {

    private static final String DEFAULT_KEY = "default";

    private final XianyuReplyConfigRepository repository;
    private final ObjectMapper objectMapper;

    public XianyuReplyConfigService(XianyuReplyConfigRepository repository, ObjectMapper objectMapper) {
        this.repository = repository;
        this.objectMapper = objectMapper;
    }

    @Transactional(readOnly = true)
    public XianyuReplyConfigResponse getDefaultConfig() {
        long userId = currentUserId();
        XianyuReplyConfig config = repository.findByUserIdAndConfigKey(userId, storageKey(userId)).orElse(null);
        if (config == null) {
            return new XianyuReplyConfigResponse(
                    DEFAULT_KEY,
                    objectMapper.createObjectNode(),
                    objectMapper.createArrayNode(),
                    false,
                    null
            );
        }
        return toResponse(config);
    }

    @Transactional
    public XianyuReplyConfigResponse saveDefaultConfig(XianyuReplyConfigRequest request) {
        long userId = currentUserId();
        XianyuReplyConfig config = repository.findByUserIdAndConfigKey(userId, storageKey(userId)).orElseGet(() -> {
            XianyuReplyConfig created = new XianyuReplyConfig();
            created.setConfigKey(storageKey(userId));
            return created;
        });
        JsonNode templates = request.templates();
        JsonNode keywordRules = request.keywordRules();
        if (!templates.isObject()) {
            throw new BusinessException("templates must be a JSON object");
        }
        if (!keywordRules.isArray()) {
            throw new BusinessException("keywordRules must be a JSON array");
        }
        config.setTemplatesJson(toJson((ObjectNode) templates));
        config.setKeywordRulesJson(toJson((ArrayNode) keywordRules));
        config.setTextFallbackEnabled(request.textFallbackEnabled());
        return toResponse(repository.save(config));
    }

    private XianyuReplyConfigResponse toResponse(XianyuReplyConfig config) {
        return new XianyuReplyConfigResponse(
                DEFAULT_KEY,
                parseJson(config.getTemplatesJson(), "templates"),
                parseJson(config.getKeywordRulesJson(), "keywordRules"),
                config.isTextFallbackEnabled(),
                config.getUpdatedAt()
        );
    }

    private long currentUserId() {
        Long userId = UserScopeContext.get();
        if (userId == null) {
            throw new BusinessException("current user scope is required for xianyu reply config");
        }
        return userId;
    }

    private String storageKey(long userId) {
        return "user:" + userId + ":default";
    }

    private String toJson(JsonNode value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new BusinessException("invalid reply config JSON", exception);
        }
    }

    private JsonNode parseJson(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new BusinessException("stored reply config " + field + " is missing");
        }
        try {
            return objectMapper.readTree(value);
        } catch (JsonProcessingException exception) {
            throw new BusinessException("stored reply config " + field + " is invalid JSON", exception);
        }
    }
}
