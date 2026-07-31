package com.movie.ticket.audit;

import com.movie.ticket.dto.ApiResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/v1/admin/audit-logs")
public class AdminAuditController {

    private final AuditLogRepository repository;

    public AdminAuditController(AuditLogRepository repository) {
        this.repository = repository;
    }

    @GetMapping
    public ApiResponse<List<AuditLogView>> list() {
        return ApiResponse.ok(repository.findTop100ByOrderByCreatedAtDesc().stream()
                .map(AuditLogView::from)
                .toList());
    }
}
