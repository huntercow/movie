package com.movie.ticket.controller;

import com.movie.ticket.dto.ApiResponse;
import com.movie.ticket.dto.CreateQuoteRequest;
import com.movie.ticket.dto.QuoteResponse;
import com.movie.ticket.service.QuoteService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/quotes")
public class QuoteController {

    private final QuoteService quoteService;

    public QuoteController(QuoteService quoteService) {
        this.quoteService = quoteService;
    }

    @PostMapping
    public ApiResponse<QuoteResponse> createQuote(@Valid @RequestBody CreateQuoteRequest request) {
        return ApiResponse.ok(quoteService.createQuote(request));
    }

    @GetMapping("/{quoteNo}")
    public ApiResponse<QuoteResponse> getQuote(@PathVariable String quoteNo) {
        return ApiResponse.ok(quoteService.getQuote(quoteNo));
    }
}
