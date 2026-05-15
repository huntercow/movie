package com.movie.ticket.upstream;

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

    public String getUserToken(String fallback) {
        String current = redisTemplate.opsForValue().get(USER_TOKEN_KEY);
        return StringUtils.hasText(current) ? current : fallback;
    }

    public void setUserToken(String token) {
        if (StringUtils.hasText(token)) {
            redisTemplate.opsForValue().set(USER_TOKEN_KEY, token);
        }
    }

    public void setUserProfile(String id, String userName, String nickname, String headImg) {
        setIfPresent(USER_ID_KEY, id);
        setIfPresent(USER_NAME_KEY, userName);
        setIfPresent(NICKNAME_KEY, nickname);
        setIfPresent(HEAD_IMG_KEY, headImg);
    }

    public String getUserId() {
        return redisTemplate.opsForValue().get(USER_ID_KEY);
    }

    public String getUserName() {
        return redisTemplate.opsForValue().get(USER_NAME_KEY);
    }

    private void setIfPresent(String key, String value) {
        if (StringUtils.hasText(value)) {
            redisTemplate.opsForValue().set(key, value);
        }
    }
}
