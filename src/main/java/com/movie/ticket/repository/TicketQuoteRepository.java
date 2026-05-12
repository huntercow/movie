package com.movie.ticket.repository;

import com.movie.ticket.entity.TicketQuote;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface TicketQuoteRepository extends JpaRepository<TicketQuote, Long> {
    Optional<TicketQuote> findByQuoteNo(String quoteNo);
}
