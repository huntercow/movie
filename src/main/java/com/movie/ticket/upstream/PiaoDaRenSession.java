package com.movie.ticket.upstream;

import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.concurrent.atomic.AtomicReference;

@Component
public class PiaoDaRenSession {

    private final AtomicReference<String> userToken = new AtomicReference<>();

    public String getUserToken(String fallback) {
        String current = userToken.get();
        return StringUtils.hasText(current) ? current : fallback;
    }

    public void setUserToken(String token) {
        if (StringUtils.hasText(token)) {
            userToken.set(token);
        }
    }
}
