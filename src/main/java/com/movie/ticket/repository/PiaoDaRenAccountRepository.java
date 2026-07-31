package com.movie.ticket.repository;

import com.movie.ticket.entity.PiaoDaRenAccount;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;

public interface PiaoDaRenAccountRepository extends JpaRepository<PiaoDaRenAccount, String> {
    Optional<PiaoDaRenAccount> findFirstByOrderByLastLoginAtDesc();

    @Modifying
    @Transactional
    @Query("update PiaoDaRenAccount account set account.userToken = null, account.rawResponse = null")
    int clearStoredSecrets();
}
