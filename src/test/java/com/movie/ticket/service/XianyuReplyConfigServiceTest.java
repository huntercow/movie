package com.movie.ticket.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.movie.ticket.dto.XianyuReplyConfigRequest;
import com.movie.ticket.entity.XianyuReplyConfig;
import com.movie.ticket.exception.BusinessException;
import com.movie.ticket.repository.XianyuReplyConfigRepository;
import com.movie.ticket.security.UserScopeContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class XianyuReplyConfigServiceTest {

    @AfterEach
    void clearUserScope() {
        UserScopeContext.clear();
    }

    @Test
    void missingUserScopeFailsClosedWithoutReadingGlobalDefault() {
        XianyuReplyConfigRepository repository = mock(XianyuReplyConfigRepository.class);

        assertThatThrownBy(() -> new XianyuReplyConfigService(repository, new ObjectMapper()).getDefaultConfig())
                .isInstanceOf(BusinessException.class)
                .hasMessage("current user scope is required for xianyu reply config");

        org.mockito.Mockito.verifyNoInteractions(repository);
    }

    @Test
    void missingConfigReturnsEmptyDefaults() {
        UserScopeContext.set(44L);
        XianyuReplyConfigRepository repository = mock(XianyuReplyConfigRepository.class);
        when(repository.findByUserIdAndConfigKey(44L, "user:44:default")).thenReturn(Optional.empty());

        var result = new XianyuReplyConfigService(repository, new ObjectMapper()).getDefaultConfig();

        assertThat(result.configKey()).isEqualTo("default");
        assertThat(result.templates().isObject()).isTrue();
        assertThat(result.keywordRules().isArray()).isTrue();
        assertThat(result.textFallbackEnabled()).isFalse();
        org.mockito.Mockito.verify(repository).findByUserIdAndConfigKey(44L, "user:44:default");
        org.mockito.Mockito.verify(repository, org.mockito.Mockito.never()).findById(org.mockito.ArgumentMatchers.any());
    }

    @Test
    void saveDefaultConfigPersistsJson() throws Exception {
        UserScopeContext.set(44L);
        XianyuReplyConfigRepository repository = mock(XianyuReplyConfigRepository.class);
        ObjectMapper objectMapper = new ObjectMapper();
        when(repository.findByUserIdAndConfigKey(44L, "user:44:default")).thenReturn(Optional.empty());
        when(repository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        var result = new XianyuReplyConfigService(repository, objectMapper).saveDefaultConfig(new XianyuReplyConfigRequest(
                objectMapper.readTree("{\"hello\":\"您好\"}"),
                objectMapper.readTree("[{\"keywords\":[\"你好\"],\"reply\":\"您好\"}]"),
                true
        ));

        assertThat(result.templates().get("hello").asText()).isEqualTo("您好");
        assertThat(result.keywordRules()).hasSize(1);
        assertThat(result.textFallbackEnabled()).isTrue();
    }

    @Test
    void saveDefaultConfigRejectsInvalidShapes() throws Exception {
        UserScopeContext.set(44L);
        XianyuReplyConfigRepository repository = mock(XianyuReplyConfigRepository.class);
        ObjectMapper objectMapper = new ObjectMapper();
        when(repository.findByUserIdAndConfigKey(44L, "user:44:default"))
                .thenReturn(Optional.of(new XianyuReplyConfig()));
        XianyuReplyConfigService service = new XianyuReplyConfigService(repository, objectMapper);

        assertThatThrownBy(() -> service.saveDefaultConfig(new XianyuReplyConfigRequest(
                objectMapper.readTree("[]"),
                objectMapper.readTree("[]"),
                false
        ))).isInstanceOf(BusinessException.class).hasMessageContaining("templates");

        assertThatThrownBy(() -> service.saveDefaultConfig(new XianyuReplyConfigRequest(
                objectMapper.readTree("{}"),
                objectMapper.readTree("{}"),
                false
        ))).isInstanceOf(BusinessException.class).hasMessageContaining("keywordRules");
    }
}
