package com.movie.ticket.repository;

import com.movie.ticket.entity.PaymentRecord;
import com.movie.ticket.entity.PaymentStatus;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface PaymentRecordRepository extends JpaRepository<PaymentRecord, Long> {
    Optional<PaymentRecord> findByPaymentRecordNo(String paymentRecordNo);

    Optional<PaymentRecord> findByUserIdAndPaymentRecordNo(Long userId, String paymentRecordNo);

    Optional<PaymentRecord> findByPaymentNo(String paymentNo);

    Optional<PaymentRecord> findByUserIdAndPaymentNo(Long userId, String paymentNo);

    Optional<PaymentRecord> findFirstByQuoteNoAndCustomerNoAndStatusOrderByConfirmedAtDesc(
            String quoteNo,
            String customerNo,
            PaymentStatus status
    );

    Optional<PaymentRecord> findFirstByUserIdAndQuoteNoAndCustomerNoAndStatusOrderByConfirmedAtDesc(
            Long userId,
            String quoteNo,
            String customerNo,
            PaymentStatus status
    );
}
