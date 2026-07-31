package com.movie.ticket.job;

import com.movie.ticket.dto.ApiResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/v1/admin/jobs")
public class AdminJobController {

    private final JobTaskRepository repository;

    public AdminJobController(JobTaskRepository repository) {
        this.repository = repository;
    }

    @GetMapping
    public ApiResponse<List<JobTaskView>> list() {
        return ApiResponse.ok(repository.findTop100ByOrderByCreatedAtDesc().stream()
                .map(JobTaskView::from)
                .toList());
    }
}
