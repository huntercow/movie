package com.movie.ticket.upstream;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

@Component
public class PiaoDaRenSession {

    private static final String USER_TOKEN_KEY = "ticket:upstream:piaodaren:user-token";

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
}
