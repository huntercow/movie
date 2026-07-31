package com.movie.ticket.upstream;

import com.movie.ticket.security.UserScopeContext;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

@Component
public class PiaoDaRenSession {

    private static final String USER_TOKEN_KEY = "ticket:upstream:piaodaren:user-token";
    private static final String USER_ID_KEY = "ticket:upstream:piaodaren:user-id";
    private static final String USER_NAME_KEY = "ticket:upstream:piaodaren:user-name";
    private static final String NICKNAME_KEY = "ticket:upstream:piaodaren:nickname";
    private static final String HEAD_IMG_KEY = "ticket:upstream:piaodaren:head-img";

    private final StringRedisTemplate redisTemplate;
    public PiaoDaRenSession(StringRedisTemplate redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    public String getUserToken() {
        return getValue(USER_TOKEN_KEY);
    }

    public void setUserToken(String token) {
        if (!StringUtils.hasText(token)) {
            throw new IllegalArgumentException("upstream user token is required");
        }
        setValue(USER_TOKEN_KEY, token);
    }

    public void clear() {
        redisTemplate.delete(scopedKey(USER_TOKEN_KEY));
    }

    public void setUserProfile(String id, String userName, String nickname, String headImg) {
        setIfPresent(USER_ID_KEY, id);
        setIfPresent(USER_NAME_KEY, userName);
        setIfPresent(NICKNAME_KEY, nickname);
        setIfPresent(HEAD_IMG_KEY, headImg);
    }

    public String getUserId() {
        return getValue(USER_ID_KEY);
    }

    public String getUserName() {
        return getValue(USER_NAME_KEY);
    }

    public String getNickname() {
        return getValue(NICKNAME_KEY);
    }

    public String getHeadImg() {
        return getValue(HEAD_IMG_KEY);
    }

    private void setIfPresent(String key, String value) {
        if (StringUtils.hasText(value)) {
            setValue(key, value);
        }
    }

    private String getValue(String key) {
        return redisTemplate.opsForValue().get(scopedKey(key));
    }

    private void setValue(String key, String value) {
        redisTemplate.opsForValue().set(scopedKey(key), value);
    }

    private String scopedKey(String baseKey) {
        Long userId = UserScopeContext.get();
        return baseKey + ":" + (userId == null ? "legacy" : userId);
    }
}
