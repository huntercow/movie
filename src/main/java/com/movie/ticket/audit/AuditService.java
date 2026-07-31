package com.movie.ticket.audit;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.movie.ticket.exception.BusinessException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;

@Service
public class AuditService {

    private final AuditLogRepository repository;
    private final ObjectMapper objectMapper;

    public AuditService(AuditLogRepository repository, ObjectMapper objectMapper) {
        this.repository = repository;
        this.objectMapper = objectMapper;
    }

    public void record(
            Long actorUserId,
            Long targetUserId,
            String action,
            String resourceType,
            String resourceId,
            Object before,
            Object after,
            HttpServletRequest request
    ) {
        AuditLog log = new AuditLog();
        log.setActorUserId(actorUserId);
        log.setTargetUserId(targetUserId);
        log.setAction(action);
        log.setResourceType(resourceType);
        log.setResourceId(resourceId);
        log.setBeforeJson(toJson(before));
        log.setAfterJson(toJson(after));
        log.setIpAddress(request == null ? null : request.getRemoteAddr());
        log.setCreatedAt(LocalDateTime.now());
        repository.save(log);
    }

    private String toJson(Object value) {
        if (value == null) {
            return null;
        }
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new BusinessException("unable to serialize audit payload", exception);
        }
    }
}
