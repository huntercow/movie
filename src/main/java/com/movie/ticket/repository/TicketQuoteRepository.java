package com.movie.ticket.repository;

import com.movie.ticket.entity.TicketQuote;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import jakarta.persistence.LockModeType;

import java.util.Optional;
import java.util.List;

public interface TicketQuoteRepository extends JpaRepository<TicketQuote, Long> {
    Optional<TicketQuote> findByQuoteNo(String quoteNo);

    Optional<TicketQuote> findByUserIdAndQuoteNo(Long userId, String quoteNo);

    List<TicketQuote> findTop100ByUserIdOrderByCreatedAtDesc(Long userId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select quote from TicketQuote quote where quote.quoteNo = :quoteNo")
    Optional<TicketQuote> findByQuoteNoForUpdate(@Param("quoteNo") String quoteNo);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select quote from TicketQuote quote where quote.userId = :userId and quote.quoteNo = :quoteNo")
    Optional<TicketQuote> findByUserIdAndQuoteNoForUpdate(
            @Param("userId") Long userId,
            @Param("quoteNo") String quoteNo
    );
}
