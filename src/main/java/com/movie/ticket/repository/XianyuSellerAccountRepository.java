package com.movie.ticket.repository;

import com.movie.ticket.entity.XianyuSellerAccount;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface XianyuSellerAccountRepository extends JpaRepository<XianyuSellerAccount, Long> {
    Optional<XianyuSellerAccount> findBySellerUserId(String sellerUserId);
}
